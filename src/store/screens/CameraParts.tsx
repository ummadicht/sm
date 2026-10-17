// The advisor's camera steps on the Session screen — GradeIQ's camera page on THIS
// device — and the "Camera AI (GradeIQ)" results card. Everything shown comes from
// session.grading (../grading.ts); nothing here makes up a grade, a verdict or a reason.
//
// Two passes (docs/TWO-PASS-CAMERA.md in the server repo, 2026-10-17):
//   PhotosStepCard — step 1: the photos, BEFORE the customer's phone joins. No app is
//                    needed for them, so the button is there at once (photosUrl).
//   ScreenStepCard — step 4: the screen check, AFTER its tests. The phone has to show
//                    the colours the camera asks for, so it stays locked until the phone
//                    is on its photo screen (screenUrl — fail closed, override with a reason).
// CameraStepCard is the one-pass card an older server gets (cameraUrl does both).
//
// The phone-led flow (docs/PHONE-LED-FLOW.md, SwapUp Check 0.6.0+):
//   ScanStepCard   — step 3: the customer's phone shows GradeIQ's camera link as a QR;
//                    this tablet's camera app scans it, and the camera page photographs
//                    the phone and checks its screen in one pass. "Take photos" opens the
//                    same page from here (cameraUrl — the same fail-closed gate and override).
import React, { useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { CameraFault, CameraFinding, CameraGrading, CameraResult, GRADE_MEANING, disagreementLine, findingLine, pct, photosStep } from "../grading";
import type { Layout, PhonePhase, ScanStage } from "../phoneLed";
import { openCameraPage, openInDefaultBrowser } from "../openCamera";
import { StaffClient, errText } from "../staffClient";
import type { TestSessionView } from "../types";
import { faultLabel } from "./SessionParts";
import Svg, { Path, Rect } from "react-native-svg";
import { Banner, Body, Btn, Card, Chip, Field, Figure, H2, KV, Label, Tone, ago, toneColor, L } from "../ui";

const IS_WEB = Platform.OS === "web";
/** The server refuses shorter reasons (testSessions.cameraOverride). */
const MIN_REASON = 8;
/** A phone that has joined but isn't echoing yet is usually still opening the photo screen: don't tempt an override for this long. */
const OVERRIDE_GRACE_MS = 30_000;
/** A photos-last phone that has sent no result for this long is treated as having stopped. */
const STALE_TESTING_MS = 180_000;

/** SwapUp Check 0.3.0+ native (not "web-…"): tests first, photo screen last. */
export function photosLastApp(appVersion: string | null): boolean {
  const m = /^(\d+)\.(\d+)\./.exec(appVersion ?? "");
  if (!m) return false;
  return Number(m[1]) > 0 || Number(m[2]) >= 3;
}

/** The server's sentence, ending with the advice to check by eye exactly once. */
export function byEye(msg: string | null | undefined): string {
  const m = (msg ?? "").trim();
  return /by eye/i.test(m) ? m : `${m ? `${m.replace(/\.?$/, ".")} ` : ""}Check the condition by eye.`;
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["applied", "expired", "cancelled"]);

// ── shared by the camera cards ───────────────────────────────────────────────

/**
 * Where the customer's phone is, as far as the camera lock goes — the one-pass card
 * and the screen check share it, so both hold an override back for the same reasons.
 */
function usePhoneGate(v: TestSessionView, g: CameraGrading) {
  // When the customer's phone last made progress, on THIS device's clock (the
  // results carry the phone's own clock, which may be minutes off).
  const activity = useRef<{ sig: string; at: number }>({ sig: "", at: Date.now() });
  const activitySig = `${v.status}|${v.progress?.done ?? 0}|${Object.keys(v.results ?? {}).length}`;
  if (activitySig !== activity.current.sig) activity.current = { sig: activitySig, at: Date.now() };
  const status = v.status;
  const joined = status === "joined" || status === "testing" || status === "complete";
  // SwapUp Check 0.3.0+ (native) runs its tests FIRST and shows the photo screen
  // last, so a phone that is testing is on its way there — not gone. The browser
  // check and older apps never come back to it: for them, progress means moved on.
  // A phone that has sent nothing for 3 minutes is not "testing" any more either.
  const photosLast = photosLastApp(v.device?.appVersion ?? null);
  const progressed = (v.progress?.done ?? 0) > 0;
  const quiet = progressed && Date.now() - activity.current.at > STALE_TESTING_MS;
  const testing = photosLast && joined && !g.deviceReady && status !== "complete" && progressed && !quiet;
  const movedOn = joined && !g.deviceReady && (status === "complete" || (!photosLast && progressed) || (photosLast && quiet));
  // The server says when an override is allowed; we hold it back while the phone is
  // still testing (the photo screen is coming), and for the first half-minute after
  // joining when nothing is wrong yet.
  const joinedFor = v.joinedAt ? Date.now() - Date.parse(v.joinedAt) : Infinity;
  const allowed = g.canOverride ?? (joined && (!!g.screenProblem || movedOn));
  const canOverride =
    allowed && joined && !g.deviceReady && !g.override && (!!g.screenProblem || movedOn || (!testing && joinedFor >= OVERRIDE_GRACE_MS));
  return { status, joined, photosLast, testing, movedOn, canOverride };
}

/** POST …/grading-retry — a fresh GradeIQ session when setting one up failed. */
function useRetry(api: StaffClient, v: TestSessionView, onSession: (r: unknown) => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function retry() {
    setErr(null);
    setBusy(true);
    try {
      onSession(await api.post<unknown>(`/api/test-sessions/${encodeURIComponent(v.id)}/grading-retry`));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return { retry, busy, err };
}

/** Open a camera page in Chrome (or a new tab in the browser app) and remember that we did. */
function useOpener() {
  const [openErr, setOpenErr] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ at: number; inChrome: boolean; url: string } | null>(null);
  async function open(url: string | null, plain = false) {
    if (!url) return;
    setOpenErr(null);
    const r = plain ? await openInDefaultBrowser(url) : await openCameraPage(url);
    if (r.ok) setOpened({ at: Date.now(), inChrome: r.inChrome, url });
    else setOpenErr(r.error);
  }
  return { open, opened, openErr };
}

/** "Take photos anyway" / "Check the screen anyway": a reason, recorded with the advisor's name. */
function OverrideBox({
  v,
  api,
  onSession,
  openTitle,
  confirmTitle,
  explain,
  placeholder,
}: {
  v: TestSessionView;
  api: StaffClient;
  onSession: (r: unknown) => void;
  openTitle: string;
  confirmTitle: string;
  explain: React.ReactNode;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    const why = reason.trim();
    if (why.length < MIN_REASON) {
      setErr("Say why in a few words — it goes on the case with your name.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const r = await api.post<unknown>(`/api/test-sessions/${encodeURIComponent(v.id)}/camera-override`, { reason: why });
      onSession(r);
      setOpen(false);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <Btn title={openTitle} kind="secondary" onPress={() => setOpen(true)} style={{ alignSelf: "flex-start" }} />;
  return (
    <View style={{ gap: 10 }}>
      <Body>{explain}</Body>
      <Field label="Why go ahead without it?" value={reason} onChangeText={setReason} placeholder={placeholder} editable={!busy} error={err} />
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Btn title={confirmTitle} onPress={send} busy={busy} style={{ flexGrow: 1 }} />
        <Btn title="Keep waiting" kind="secondary" onPress={() => setOpen(false)} disabled={busy} />
      </View>
    </View>
  );
}

function Numbered({ items }: { items: string[] }) {
  return (
    <View style={{ gap: 8 }}>
      {items.map((t, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: L.fixBg, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: L.fix, fontWeight: "800", fontSize: 15 }}>{i + 1}</Text>
          </View>
          <Text style={{ flex: 1, fontSize: 17, lineHeight: 24, color: L.text }}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

/** The instructions beside the big button: side by side on a tablet, stacked on a phone. */
function GuideAndButton({ wide, guide, button }: { wide: boolean; guide: React.ReactNode; button: React.ReactNode }) {
  return wide ? (
    <View style={{ flexDirection: "row", gap: 20, alignItems: "flex-start" }}>
      <View style={{ flex: 1, minWidth: 0 }}>{guide}</View>
      <View style={{ width: 320, gap: 10 }}>{button}</View>
    </View>
  ) : (
    <>
      {guide}
      {button}
    </>
  );
}

function StepHead({ label, title, chip }: { label: string; title: string; chip?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <View style={{ flexShrink: 1, minWidth: 0, gap: 4 }}>
        <Label>{label}</Label>
        <H2>{title}</H2>
      </View>
      {chip ?? null}
    </View>
  );
}

/** The grade chip: retake / graded / provisional. */
function gradeChip(g: CameraGrading): React.ReactNode {
  const needRetake = g.capture.verdict === "retake" || !!g.result?.obstruction?.present;
  if (needRetake) return <Chip text="Retake needed" tone="bad" />;
  if (g.result?.grade) return <Chip text={g.result.final ? `Graded ${g.result.grade}` : `Provisional ${g.result.grade}`} tone={g.result.final ? "up" : "warn"} />;
  return null;
}

/** Off, failed or not offered: say so, and send the advisor to their own eyes. */
function NoCamera({ v, g, retry }: { v: TestSessionView; g: CameraGrading; retry: ReturnType<typeof useRetry> }) {
  const title = g.phase === "disabled" ? "Camera grading is switched off" : g.phase === "failed" ? "Camera grading unavailable" : "No camera grading on this server";
  return (
    <>
      <Banner
        tone={g.phase === "failed" ? "bad" : "muted"}
        title={title}
        action={g.canRetry && !TERMINAL_STATUSES.has(v.status) ? { title: "Retry", onPress: retry.retry, busy: retry.busy } : undefined}
      >
        {byEye(g.message ?? (g.phase === "absent" ? "This SwapUp server doesn't offer camera grading yet." : null))}
      </Banner>
      {retry.err ? <Banner tone="bad" title="Camera grading still unavailable">{retry.err}</Banner> : null}
    </>
  );
}

/** A padlock as a line drawing (ink strokes, the one pale tint) — no emoji. */
function LockIcon() {
  return (
    <View accessibilityLabel="Locked" style={{ paddingTop: 2 }}>
      <Svg width={28} height={28} viewBox="0 0 28 28" fill="none">
        <Path d="M9 12V9a5 5 0 0 1 10 0v3" stroke={L.ink} strokeWidth={2} strokeLinecap="round" />
        <Rect x={5.5} y={12} width={17} height={12.5} rx={3.5} fill={L.tint} stroke={L.ink} strokeWidth={2} />
        <Path d="M14 16.5v3.5" stroke={L.ink} strokeWidth={2} strokeLinecap="round" />
      </Svg>
    </View>
  );
}

function Locked({ title, text }: { title: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start", padding: 16, borderRadius: L.radius + 4, backgroundColor: L.surface2 }}>
      <LockIcon />
      <View style={{ flex: 1, gap: 4 }}>
        <H2 style={{ fontSize: 18, lineHeight: 23 }}>{title}</H2>
        <Body muted>{text}</Body>
      </View>
    </View>
  );
}

function OpenButton({ title, primary, onPress }: { title: string; primary: boolean; onPress: () => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Btn title={title} kind={primary ? "primary" : "secondary"} onPress={onPress} big />
      <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>
        {IS_WEB
          ? "Opens the camera page in a new tab. Chrome on an Android tablet takes the torch-lit photos."
          : "Opens the camera page in Chrome on this device. Come back here when it says it's done."}
      </Text>
    </View>
  );
}

function OpenedNote({ opened, onPlain }: { opened: { at: number; inChrome: boolean; url: string } | null; onPlain?: (url: string) => void }) {
  if (!opened) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: opened.inChrome ? L.muted : L.warn, fontSize: 14, lineHeight: 20, fontWeight: opened.inChrome ? "400" : "700" }}>
        {opened.inChrome
          ? `Camera page opened ${ago(new Date(opened.at).toISOString()) || "just now"}.`
          : IS_WEB
            ? "Opened in this browser. Without Chrome on Android there are no torch-lit photos."
            : "Chrome isn't on this device, so the camera page opened in the default browser — no torch-lit photos."}
      </Text>
      {/* If Chrome came up without GradeIQ's camera page, the plain browser hand-off always works. */}
      {opened.inChrome && !IS_WEB && onPlain ? (
        <Btn title="Didn't open? Open in the default browser" kind="ghost" onPress={() => onPlain(opened.url)} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} />
      ) : null}
    </View>
  );
}

// ── one pass (an older server): Step ③ Photograph the phone ───────────────────

export function CameraStepCard({
  v,
  g,
  api,
  wide,
  onSession,
}: {
  v: TestSessionView;
  g: CameraGrading;
  api: StaffClient;
  wide: boolean;
  /** The override answered with a fresh session (or a fresh grading object). */
  onSession: (r: unknown) => void;
}) {
  const gate = usePhoneGate(v, g);
  const retry = useRetry(api, v, onSession);
  const opener = useOpener();
  const head = <StepHead label="Step 3 · advisor" title="Photograph the phone" chip={gradeChip(g)} />;

  if (g.phase === "absent" || g.phase === "disabled" || g.phase === "failed") {
    return (
      <Card>
        <StepHead label="Step 3 · advisor" title="Photograph the phone" />
        <NoCamera v={v} g={g} retry={retry} />
      </Card>
    );
  }

  const { status, joined, photosLast, testing, movedOn, canOverride } = gate;
  const graded = !!g.result?.grade;
  const needRetake = g.capture.verdict === "retake" || !!g.result?.obstruction?.present;
  const again = graded || needRetake;
  const unlocked = !!g.cameraUrl && (g.deviceReady || !!g.override);

  const guidance = (
    <Numbered
      items={[
        "Take the case off the customer's phone.",
        "Wipe the screen and the back.",
        "Leave SwapUp Check open on the counter, screen up — the camera page tells it what to show.",
        "Follow the prompts on the camera page until it says it's done.",
      ]}
    />
  );

  let body: React.ReactNode;
  if (status === "expired" || status === "cancelled") {
    body = <Body muted>{graded ? "Photos were taken for this test." : "Not camera-graded — this test ended before photos were taken."}</Body>;
  } else if (status === "applied") {
    body = <Body muted>{graded ? "Photos were taken before the results went on the case." : "Not camera-graded — the results went on the case without photos."}</Body>;
  } else if (g.phase === "pending") {
    body = (
      <Banner tone="muted" title="Setting up camera grading…">
        {g.message || "This takes a few seconds. You can carry on — the button appears here."}
      </Banner>
    );
  } else if (!unlocked) {
    // Locked until the customer's phone is echoing the camera's patterns (fail closed).
    body = (
      <View style={{ gap: 12 }}>
        <Locked
          title={
            g.deviceReady
              ? "Getting the camera link from SwapUp…"
              : g.screenProblem
                ? "Can't confirm the customer's phone is ready"
                : testing
                  ? "The customer's phone is running its tests"
                  : joined
                    ? "Waiting for the customer's phone to show the photo screen"
                    : "Waiting for the customer's phone to open SwapUp Check"
          }
          text={
            g.screenProblem ??
            // Moved on before finishing (stopped, or an app that never shows the photo screen): our own words —
            // the server's sentence may still say the screen is coming.
            (movedOn && status !== "complete"
              ? photosLast
                ? "The customer's phone isn't on the photo screen and hasn't sent anything for a few minutes. Ask the customer to reopen SwapUp Check, or use \"Take photos anyway\" with a reason."
                : "This check (the browser version, or an older app) doesn't show the photo screen. Use \"Take photos anyway\" with a reason — the display is then checked by eye."
              : null) ??
            g.cameraLocked ??
            (g.deviceReady
              ? "The customer's phone is ready. The button appears in a moment."
              : testing
                ? "Photos are the last step: when the tests finish, the phone asks to be laid on the counter and this unlocks by itself. Take the case off it and wipe the screen meanwhile."
                : joined
                  ? "This unlocks by itself once the phone is lying on the counter showing SwapUp Check's photo screen."
                  : "Photos come after the customer's tests: the phone shows the screen patterns the camera asks for, so the screen gets checked too.")
          }
        />
        {g.screenProblem ? null : movedOn ? (
          <Banner tone="warn" title={status === "complete" ? "The customer's phone finished without photos" : "The customer's phone has moved on"}>
            It isn't showing the photo screen, so the camera can't check the display. You can still photograph the outside.
          </Banner>
        ) : null}
        {canOverride ? (
          <OverrideBox
            v={v}
            api={api}
            onSession={onSession}
            openTitle="Take photos anyway"
            confirmTitle="Take photos without the screen check"
            placeholder="e.g. customer's phone won't stay on the photo screen"
            explain={
              <>
                Without the customer's phone paired, the display is <Text style={{ fontWeight: "800" }}>not camera-checked</Text>. The photos still grade the glass, back and frame.
                Your name and reason go on the case.
              </>
            }
          />
        ) : null}
      </View>
    );
  } else {
    body = (
      <View style={{ gap: 14 }}>
        {g.override ? (
          <Banner tone="warn" title="LCD not camera-checked">
            {`Going ahead without the customer's phone paired${overrideWho(g) ? ` (${overrideWho(g)})` : ""}. Check the display by eye.`}
          </Banner>
        ) : null}
        <GuideAndButton
          wide={wide}
          guide={guidance}
          button={
            <>
              <OpenButton title={again ? "Retake photos" : "Take photos"} primary={!graded || needRetake} onPress={() => opener.open(g.cameraUrl)} />
              <OpenedNote opened={opener.opened} onPlain={(u) => opener.open(u, true)} />
            </>
          }
        />
        {opener.openErr ? <Banner tone="bad" title="Camera page didn't open">{opener.openErr}</Banner> : null}
        <Progress g={g} />
        {g.outOfSync ? <OutOfSync /> : null}
      </View>
    );
  }

  return (
    <Card style={{ gap: 14 }}>
      {head}
      {body}
    </Card>
  );
}

const OutOfSync = () => <Text style={{ color: L.muted, fontSize: 14 }}>GradeIQ out of sync, retrying — SwapUp's own test results are unaffected.</Text>;

const overrideWho = (g: CameraGrading) => [g.override?.by, g.override?.reason].filter(Boolean).join(": ");

// ── two passes: Step 1 · Photograph the phone (before it joins) ───────────────

export function PhotosStepCard({
  v,
  g,
  api,
  wide,
  skipped,
  onSkip,
  onSession,
}: {
  v: TestSessionView;
  g: CameraGrading;
  api: StaffClient;
  wide: boolean;
  /** "Skip photos" was tapped. It records nothing on the server. */
  skipped: boolean;
  onSkip: (skip: boolean) => void;
  onSession: (r: unknown) => void;
}) {
  const retry = useRetry(api, v, onSession);
  const opener = useOpener();
  const step = photosStep(g, skipped);
  const status = v.status;
  const graded = !!g.result?.grade;
  const needRetake = g.capture.verdict === "retake" || !!g.result?.obstruction?.present;
  // Photos while the customer's phone is ALREADY on its photo screen (connected
  // before the photos were taken): a photos-only pass ends with a NEW cosmeticDone,
  // and the phone leaves its photo screen 30 s after that — before the screen check
  // could run. The one-pass page (cameraUrl, unlocked by the same rule as the screen
  // check) takes the photos and checks the screen in one go instead.
  const both = g.deviceReady && !g.screenDone && !!g.cameraUrl;
  const url = both ? g.cameraUrl : g.photosUrl;

  const chip =
    step === "skipped" ? <Chip text="Skipped" tone="muted" /> : (gradeChip(g) ?? (step === "done" ? <Chip text="Photos taken" tone="up" /> : null));
  const head = <StepHead label="Step 1 · advisor" title="Photograph the phone" chip={chip} />;
  const skipLink = (
    <View style={{ gap: 4 }}>
      <Btn title="Skip photos" kind="ghost" onPress={() => onSkip(true)} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} />
      <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>Without photos the trade-in has no camera grade — the glass, back and frame are checked by eye.</Text>
    </View>
  );

  let body: React.ReactNode;
  if (status === "expired" || status === "cancelled") {
    body = <Body muted>{graded || g.photosDone ? "Photos were taken for this test." : "Not camera-graded — this test ended before photos were taken."}</Body>;
  } else if (status === "applied") {
    body = <Body muted>{graded || g.photosDone ? "Photos were taken before the results went on the case." : "Not camera-graded — the results went on the case without photos."}</Body>;
  } else if (step === "none") {
    body = (
      <>
        <NoCamera v={v} g={g} retry={retry} />
        <Body muted>Carry on with step 2.</Body>
      </>
    );
  } else if (step === "pending") {
    body = (
      <>
        <Banner tone="muted" title="Setting up camera grading…">
          {g.message || "This takes a few seconds — the button appears here."}
        </Banner>
        {skipLink}
      </>
    );
  } else if (step === "skipped") {
    body = (
      <>
        <Banner tone="muted" title="Photos skipped — no camera grade">
          Check the glass, back and frame by eye. The screen can still be camera-checked at step 4.
        </Banner>
        <Btn title="Take photos after all" kind="ghost" onPress={() => onSkip(false)} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} />
      </>
    );
  } else if (!url) {
    body = (
      <>
        <Body muted>Getting the camera link from SwapUp…</Body>
        {step === "todo" ? skipLink : null}
      </>
    );
  } else if (step === "done" && !needRetake) {
    // Taken: the result, and a retake if the advisor wants one.
    body = (
      <View style={{ gap: 12 }}>
        <Body>
          {status === "waiting" || status === "opened"
            ? "Photos accepted. Next, connect the customer's phone (step 2)."
            : "Photos accepted. The grade shows here and in Camera AI below."}
        </Body>
        <Progress g={g} />
        {g.outOfSync ? <OutOfSync /> : null}
        {both ? <Body muted>The customer's phone is on its photo screen now, so a retake also checks the screen.</Body> : null}
        <Btn title="Retake photos" kind="secondary" onPress={() => opener.open(url)} style={{ alignSelf: "flex-start" }} />
        <OpenedNote opened={opener.opened} onPlain={(u) => opener.open(u, true)} />
        {opener.openErr ? <Banner tone="bad" title="Camera page didn't open">{opener.openErr}</Banner> : null}
      </View>
    );
  } else {
    const guidance = (
      <Numbered
        items={
          both
            ? [
                "Take the case off the customer's phone.",
                "Wipe the screen and the back.",
                "Leave SwapUp Check open on the counter, screen up — the camera page tells it what to show.",
                "Follow the prompts on the camera page until it says it's done.",
              ]
            : [
                "Take the case off the customer's phone.",
                "Wipe the screen and the back.",
                "Follow the camera page — it asks for each side in turn — until it says the photos are done.",
              ]
        }
      />
    );
    body = (
      <View style={{ gap: 14 }}>
        {both ? (
          <Banner tone="fix" title="The customer's phone is already on its photo screen">
            So this takes the photos and checks the screen in one go.
          </Banner>
        ) : (
          <Body muted>No app needed on the customer's phone for this — it comes before the phone is connected.</Body>
        )}
        <GuideAndButton
          wide={wide}
          guide={guidance}
          button={
            <>
              <OpenButton title={needRetake ? "Retake photos" : "Take photos"} primary onPress={() => opener.open(url)} />
              <OpenedNote opened={opener.opened} onPlain={(u) => opener.open(u, true)} />
            </>
          }
        />
        {opener.openErr ? <Banner tone="bad" title="Camera page didn't open">{opener.openErr}</Banner> : null}
        <Progress g={g} />
        {g.outOfSync ? <OutOfSync /> : null}
        {step === "todo" ? skipLink : null}
      </View>
    );
  }

  return (
    <Card style={{ gap: 14 }}>
      {head}
      {body}
    </Card>
  );
}

// ── two passes: Step 4 · Check the screen (after the tests) ───────────────────

export function ScreenStepCard({
  v,
  g,
  api,
  wide,
  onSession,
}: {
  v: TestSessionView;
  g: CameraGrading;
  api: StaffClient;
  wide: boolean;
  onSession: (r: unknown) => void;
}) {
  const gate = usePhoneGate(v, g);
  const opener = useOpener();
  const { status, joined, photosLast, testing, movedOn, canOverride } = gate;
  const d = g.result?.display ?? null;
  const verdictChip =
    d?.verdict === "pass" ? (
      <Chip text="No faults seen" tone="up" />
    ) : d?.verdict === "fail" ? (
      <Chip text="Fault seen" tone="bad" />
    ) : !d && g.gradePending ? (
      <Chip text="Working it out…" tone="fix" />
    ) : g.screenDone ? (
      <Chip text="No clear verdict" tone="warn" />
    ) : null;
  const head = <StepHead label="Step 4 · advisor" title="Check the screen" chip={g.screenDone || d ? verdictChip : null} />;

  let body: React.ReactNode;
  if (status === "expired" || status === "cancelled") {
    body = <Body muted>{g.screenDone ? "The screen was camera-checked for this test." : "Not camera-checked — this test ended before the screen check."}</Body>;
  } else if (status === "applied") {
    body = <Body muted>{g.screenDone ? "The screen was camera-checked before the results went on the case." : "Not camera-checked — the results went on the case without a screen check."}</Body>;
  } else if (g.phase === "absent" || g.phase === "disabled" || g.phase === "failed") {
    body = <Body muted>No camera grading for this trade-in — check the screen by eye.</Body>;
  } else if (g.phase === "pending") {
    body = <Body muted>Setting up camera grading…</Body>;
  } else if (g.screenDone) {
    body = (
      <View style={{ gap: 8 }}>
        <Body>
          {d?.verdict === "pass"
            ? "Checked by this tablet's camera — no screen faults seen."
            : d?.verdict === "fail"
              ? "Checked by this tablet's camera — it saw a screen fault. Details in Camera AI below."
              : !d && g.gradePending
                ? "Screen check done — the camera's verdict is being worked out. It usually lands within 30 seconds."
                : "The screen check ran, but gave no clear verdict. Check the screen by eye."}
        </Body>
        {d?.missing.length ? <Body muted>{`Colours not captured: ${d.missing.join(", ")}.`}</Body> : null}
        {g.override ? <Body muted>{`Unlocked by override${overrideWho(g) ? ` (${overrideWho(g)})` : ""} — recorded as not camera-checked.`}</Body> : null}
      </View>
    );
  } else if (!g.screenUrl) {
    // Locked until the customer's phone is echoing the camera's patterns (fail closed).
    body = (
      <View style={{ gap: 12 }}>
        <Locked
          title={
            g.deviceReady
              ? "Getting the camera link from SwapUp…"
              : g.screenProblem
                ? "Can't confirm the customer's phone is ready"
                : testing
                  ? "The customer's phone is running its tests"
                  : joined
                    ? "Waiting for the customer's phone to show its photo screen"
                    : "Waiting for the customer's phone"
          }
          text={
            g.screenProblem ??
            (movedOn && status !== "complete"
              ? photosLast
                ? "The customer's phone isn't on its photo screen and hasn't sent anything for a few minutes. Ask the customer to reopen SwapUp Check, or check the screen by eye."
                : "This check (the browser version, or an older app) doesn't show the photo screen, so the camera can't check the display. Check it by eye."
              : null) ??
            // Not g.cameraLocked: the server's sentence describes the one-pass camera ("Photos now
            // need an override…"), which is wrong for this card — it only guards the screen check.
            (g.deviceReady
              ? "The customer's phone is ready. The button appears in a moment."
              : testing
                ? "When the tests finish, the phone asks to be laid on the counter, screen up, and this unlocks by itself."
                : joined
                  ? "This unlocks by itself once the phone is lying on the counter showing SwapUp Check's photo screen."
                  : "Connect the customer's phone first (step 2). After its tests it shows a photo screen, and this unlocks by itself.")
          }
        />
        {g.screenProblem ? null : movedOn ? (
          <Banner tone="warn" title={status === "complete" ? "The customer's phone finished without the screen check" : "The customer's phone has moved on"}>
            It isn't showing its photo screen, so the camera can't check the display. Check it by eye.
          </Banner>
        ) : null}
        {canOverride ? (
          <OverrideBox
            v={v}
            api={api}
            onSession={onSession}
            openTitle="Check the screen anyway"
            confirmTitle="Unlock the screen check"
            placeholder="e.g. the phone is on its photo screen but this stays locked"
            explain={
              <>
                Only worth it if the customer's phone IS on its photo screen and SwapUp can't confirm it — otherwise the camera has nothing to check. The display is
                recorded as <Text style={{ fontWeight: "800" }}>not camera-checked</Text>, and your name and reason go on the case.
              </>
            }
          />
        ) : null}
      </View>
    );
  } else {
    body = (
      <View style={{ gap: 14 }}>
        {g.override ? (
          <Banner tone="warn" title="LCD not camera-checked">
            {`Going ahead without the customer's phone confirmed${overrideWho(g) ? ` (${overrideWho(g)})` : ""}. Check the display by eye too.`}
          </Banner>
        ) : null}
        <GuideAndButton
          wide={wide}
          guide={
            <Numbered
              items={[
                "Keep the customer's phone on the counter, screen up, on SwapUp Check's photo screen.",
                "Hold this tablet's camera over it — the phone shows white, black and colours as the camera asks.",
                "Hold still until the camera page says “Screen checked”.",
              ]}
            />
          }
          button={
            <>
              <OpenButton title="Check the screen" primary onPress={() => opener.open(g.screenUrl)} />
              <OpenedNote opened={opener.opened} onPlain={(u) => opener.open(u, true)} />
            </>
          }
        />
        {opener.openErr ? <Banner tone="bad" title="Camera page didn't open">{opener.openErr}</Banner> : null}
        {g.outOfSync ? <OutOfSync /> : null}
      </View>
    );
  }

  return (
    <Card style={{ gap: 14 }}>
      {head}
      {body}
    </Card>
  );
}

// ── phone-led: Step 3 · Scan the customer's phone ────────────────────────────

const SCAN_HINT = "Scan the code on the customer's phone — this ticks when the camera page opens.";

export function ScanStepCard({
  v,
  g,
  api,
  wide,
  phase,
  stage,
  onSession,
}: {
  v: TestSessionView;
  g: CameraGrading;
  api: StaffClient;
  wide: boolean;
  phase: PhonePhase | null;
  /** ../phoneLed.ts scanStage(), worked out once by the Session screen. */
  stage: ScanStage;
  onSession: (r: unknown) => void;
}) {
  const retry = useRetry(api, v, onSession);
  const opener = useOpener();
  // When the phone reached this stage, on THIS device's clock: a phone on its Scan
  // step that SwapUp hasn't seen echo yet is usually still drawing its code, so an
  // override is held back for half a minute (as the photos-last gate does).
  const since = useRef<{ key: string; at: number }>({ key: "", at: Date.now() });
  const key = `${stage}|${phase}`;
  if (since.current.key !== key) since.current = { key, at: Date.now() };
  const joined = v.status === "joined" || v.status === "testing" || v.status === "complete";
  const needRetake = g.capture.verdict === "retake" || !!g.result?.obstruction?.present;
  const unlocked = !!g.cameraUrl && (g.deviceReady || !!g.override);
  const stuck = stage === "now" && !g.deviceReady && Date.now() - since.current.at >= OVERRIDE_GRACE_MS;
  // The server says when an override is allowed; we offer it only when the camera can't
  // get in the normal way: the phone moved on unscanned, or SwapUp can't see it echo.
  const canOverride = (g.canOverride ?? true) && joined && !g.deviceReady && !g.override && (stage === "skipped" || !!g.screenProblem || stuck);
  // A retake needs the phone still on its scan code, or it photographs the outside only.
  const onScan = phase === "scan" || (phase === null && g.deviceReady);

  const chip =
    stage === "now" ? (
      (gradeChip(g) ?? <Chip text={g.capture.connected ? "Scanning" : "Scan now"} tone="fix" />)
    ) : stage === "done" ? (
      (gradeChip(g) ?? <Chip text="Scanned" tone="up" />)
    ) : stage === "skipped" ? (
      (gradeChip(g) ?? <Chip text="Not scanned" tone="warn" />)
    ) : null;
  const head = <StepHead label="Step 3 · advisor" title="Scan the customer's phone" chip={chip} />;

  const override = canOverride ? (
    <OverrideBox
      v={v}
      api={api}
      onSession={onSession}
      openTitle="Take photos anyway"
      confirmTitle="Take photos without the screen check"
      placeholder={stage === "skipped" ? "e.g. customer skipped the scan, phone is on the counter" : "e.g. the phone shows its code but this stays locked"}
      explain={
        <>
          Without the customer's phone showing its scan screen, the display is <Text style={{ fontWeight: "800" }}>not camera-checked</Text>. The photos still grade
          the glass, back and frame. Your name and reason go on the case.
        </>
      }
    />
  ) : null;

  const takePhotos = (primary: boolean, title = needRetake ? "Retake photos" : "Take photos") => (
    <>
      <OpenButton title={title} primary={primary} onPress={() => opener.open(g.cameraUrl)} />
      <OpenedNote opened={opener.opened} onPlain={(u) => opener.open(u, true)} />
    </>
  );
  const openErr = opener.openErr ? <Banner tone="bad" title="Camera page didn't open">{opener.openErr}</Banner> : null;
  const overrideNote = g.override ? (
    <Banner tone="warn" title="LCD not camera-checked">
      {`Unlocked without the customer's phone on its scan screen${overrideWho(g) ? ` (${overrideWho(g)})` : ""}. Check the display by eye.`}
    </Banner>
  ) : null;

  let body: React.ReactNode;
  if (stage === "off") {
    body = (
      <>
        <NoCamera v={v} g={g} retry={retry} />
        {phase === "scan" ? (
          <Body muted>The customer's phone may still be waiting on its scan code: ask them to tap “Skip the camera check”, then check the screen by eye too.</Body>
        ) : null}
      </>
    );
  } else if (stage === "setup") {
    body = (
      <Banner tone="muted" title="Setting up camera grading…">
        {g.message || "This takes a few seconds. The customer's phone shows its scan code as soon as it's ready."}
      </Banner>
    );
  } else if (stage === "waiting") {
    body = (
      <View style={{ gap: 12 }}>
        <Locked
          title={joined ? "The customer's phone is identifying itself" : "Waiting for the customer's phone"}
          text={
            joined
              ? "Next it shows a QR code. Scan that with this tablet's camera app — it opens the camera page, which photographs the phone and checks its screen."
              : "Connect the customer's phone first (step 1). After it identifies itself, it shows a QR code for this tablet to scan."
          }
        />
        <Body muted>Meanwhile: take the case off the customer's phone and wipe the screen and the back.</Body>
      </View>
    );
  } else if (stage === "now") {
    body = (
      <View style={{ gap: 14 }}>
        {overrideNote}
        {g.screenProblem && !g.override ? (
          <Banner tone="warn" title="Can't confirm the customer's phone is ready">
            {g.screenProblem}
          </Banner>
        ) : g.capture.connected ? (
          <Banner tone="fix" title="Camera connected — keep both still">
            The camera page is photographing the customer's phone, then its screen shows the colours for the screen check.
          </Banner>
        ) : (
          <Banner tone="fix" title="The customer's phone is showing its scan code">
            Scan it with this tablet's camera app and tap the link. The camera page opens and the phone follows it.
          </Banner>
        )}
        <GuideAndButton
          wide={wide}
          guide={
            <Numbered
              items={[
                "Take the case off the customer's phone. Wipe the screen and the back.",
                "Open this tablet's camera app, point it at the QR code on the customer's phone, and tap the link.",
                "Follow the camera page: it photographs each side, checks the screen while the phone shows colours, then photographs the phone's About phone page.",
                "Hold still until the camera page says it's done. This card ticks along.",
              ]}
            />
          }
          button={
            unlocked ? (
              <>
                <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>Camera app won't read the code? This opens the same camera page from here.</Text>
                {takePhotos(false)}
              </>
            ) : (
              // Our own sentence, not g.cameraLocked: here the lock only means SwapUp hasn't seen the
              // phone's scan screen yet, and the QR route doesn't wait for SwapUp at all.
              <Body muted>“Take photos” appears here once SwapUp sees the phone's scan code. The QR code on the phone works already.</Body>
            )
          }
        />
        {openErr}
        <Progress g={g} connectHint={SCAN_HINT} />
        {g.outOfSync ? <OutOfSync /> : null}
        {override}
      </View>
    );
  } else if (stage === "done") {
    body = (
      <View style={{ gap: 12 }}>
        <Body>
          {g.screenDone
            ? "Scanned — the photos and the screen check are done. The grade shows here and in Camera AI below."
            : "Photos taken, but the customer's phone moved on before its screen was checked. Check the screen by eye."}
        </Body>
        {g.override ? <Body muted>{`Unlocked by override${overrideWho(g) ? ` (${overrideWho(g)})` : ""} — the LCD is recorded as not camera-checked.`}</Body> : null}
        <Progress g={g} connectHint={SCAN_HINT} />
        {g.outOfSync ? <OutOfSync /> : null}
        {unlocked && (needRetake || onScan) ? (
          <View style={{ gap: 6, alignSelf: "flex-start" }}>
            {!onScan ? <Body muted>The customer's phone has moved on, so a retake photographs the outside only.</Body> : null}
            {takePhotos(needRetake, "Retake photos")}
          </View>
        ) : null}
        {openErr}
      </View>
    );
  } else if (g.override && unlocked) {
    // Skipped, then unlocked by override: photos of the outside, no screen check.
    body = (
      <View style={{ gap: 14 }}>
        {overrideNote}
        <GuideAndButton
          wide={wide}
          guide={
            <Numbered
              items={[
                "Take the case off the customer's phone. Wipe the screen and the back.",
                "Follow the camera page — it asks for each side in turn — until it says it's done.",
              ]}
            />
          }
          button={takePhotos(true)}
        />
        {openErr}
        <Progress g={g} />
        {g.outOfSync ? <OutOfSync /> : null}
      </View>
    );
  } else {
    body = (
      <View style={{ gap: 12 }}>
        <Banner tone="warn" title={v.status === "complete" ? "The customer's phone finished without the scan" : "The customer skipped the camera check"}>
          Their phone moved on without being scanned, so the camera didn't photograph it or check its screen. Check the condition and the screen by eye.
        </Banner>
        {override}
      </View>
    );
  }

  return (
    <Card style={{ gap: 14 }}>
      {head}
      {body}
    </Card>
  );
}

/** camera connected → photos uploaded → capture ok / retake → grading… → graded. */
type Step = { label: string; state: "done" | "now" | "todo" | "bad"; detail?: string };

/** The last row: what the grade is doing. Never "grading…" when nothing is being graded. */
function gradeStep(g: CameraGrading): Step {
  const c = g.capture;
  const r = g.result;
  const why = r?.reasons.length ? r.reasons.join(" ") : undefined;
  if (c.verdict === "retake") return { label: "Grade", state: "todo", detail: "Waits for photos the camera accepts." };
  if (r?.obstruction?.present) return { label: "Case on the phone — remove it and retake", state: "bad", detail: "The grade from these photos is not used." };
  if (r?.grade) return r.final ? { label: `Graded ${r.grade}`, state: "done" } : { label: `Provisional ${r.grade}`, state: "now", detail: r.provisionalWhy ?? why };
  if (r && (r.tierUsed === "stub" || r.status === "failed")) return { label: "Grading failed", state: "bad", detail: byEye(why) };
  if (g.timedOut) return { label: "No grade came back", state: "bad", detail: byEye(why) };
  if (r?.status === "grading" || c.verdict === "ok" || c.cosmeticDone) return { label: "Grading…", state: "now", detail: "Usually 10–30 seconds after the photos are accepted." };
  return { label: "Grade", state: "todo" };
}

function Progress({ g, connectHint = "Tap “Take photos” — this ticks when the camera page opens." }: { g: CameraGrading; connectHint?: string }) {
  const c = g.capture;
  const r = g.result;
  const uploaded = c.cosmeticDone || !!c.verdict || !!r?.grade;
  const steps: Step[] = [
    c.connected
      ? { label: "Camera connected", state: "done", detail: c.connectedAt ? ago(c.connectedAt) || undefined : undefined }
      : { label: "Camera not connected yet", state: "now", detail: connectHint },
    { label: "Photos uploaded", state: uploaded ? "done" : c.connected ? "now" : "todo" },
    c.verdict === "retake"
      ? { label: "Photos rejected — retake", state: "bad", detail: c.reasons.length ? c.reasons.join(" · ") : "The camera page says what to retake." }
      : { label: "Photos accepted", state: c.verdict === "ok" ? "done" : uploaded ? "now" : "todo" },
    gradeStep(g),
  ];
  return (
    <View style={{ gap: 2, borderTopWidth: 1, borderTopColor: L.border, paddingTop: 10 }}>
      {steps.map((s, i) => {
        const color = s.state === "done" ? L.up : s.state === "bad" ? L.bad : s.state === "now" ? L.fix : L.muted;
        const icon = s.state === "done" ? "✓" : s.state === "bad" ? "✕" : s.state === "now" ? "•" : "·";
        return (
          <View key={i} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 4 }}>
            <Text style={{ width: 22, fontSize: 18, fontWeight: "900", color, textAlign: "center" }}>{icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: s.state === "todo" ? "600" : "800", color: s.state === "todo" ? L.muted : color === L.fix ? L.ink : color }}>{s.label}</Text>
              {s.detail ? <Text style={{ fontSize: 14, color: s.state === "bad" ? L.text : L.muted, lineHeight: 20 }}>{s.detail}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── Camera AI (GradeIQ) — results ─────────────────────────────────────────────

/** Why there's no letter, in the advisor's words. Null when there's nothing honest to add. */
function noGradeWhy(g: CameraGrading): { tone: Tone; title: string; text: string } | null {
  const r = g.result;
  if (g.phase === "disabled") return { tone: "muted", title: "Camera grading is switched off", text: byEye(g.message) };
  if (g.phase === "failed") return { tone: "bad", title: "Camera grading unavailable", text: byEye(g.message) };
  if (r?.obstruction?.present) return { tone: "bad", title: "Remove the case and retake", text: `The camera saw ${r.obstruction.type && r.obstruction.type !== "none" ? `a ${r.obstruction.type}` : "a case or cover"} on the phone.${r.obstruction.note ? ` ${r.obstruction.note}` : ""}` };
  if (g.capture.verdict === "retake") return { tone: "warn", title: "Photos rejected — retake", text: g.capture.reasons.length ? g.capture.reasons.join(" · ") : "The camera page says what to retake." };
  if (r && (r.tierUsed === "stub" || r.status === "failed")) return { tone: "bad", title: "Camera grading failed", text: byEye(r.reasons.join(" ") || "GradeIQ couldn't grade these photos.") };
  if (r && r.coverage !== null && r.coverage < 0.5) return { tone: "warn", title: "Not enough of the phone was visible", text: `The camera saw ${pct(r.coverage)} of the phone. Retake the photos.` };
  if (r?.status === "grading" || g.capture.cosmeticDone || g.capture.verdict === "ok")
    return { tone: "fix", title: "Grading…", text: r?.status === "grading" && r.reasons.length ? r.reasons.join(" ") : "The photos are in. The grade usually lands in 10–30 seconds." };
  if (r?.reasons.length && r.status !== "none") return { tone: "warn", title: "No camera grade yet", text: r.reasons.join(" ") };
  return null;
}

export function CameraAiCard({
  g,
  screenDue = false,
  photosSkipped = false,
  flow = "onePass",
}: {
  g: CameraGrading;
  /** The screen check (two passes: step 4; phone-led: the scan) is still to come, so "no LCD verdict" is not yet a finding. */
  screenDue?: boolean;
  /** Two passes: the advisor skipped the photos (step 1). Phone-led: the customer's phone moved on unscanned. */
  photosSkipped?: boolean;
  /** Which session layout this card sits in (../phoneLed.ts sessionLayout) — only the wording changes. */
  flow?: Layout;
}) {
  const r = g.result;
  const phoneLed = flow === "scanFirst";
  if (!r || !r.grade) {
    const why =
      noGradeWhy(g) ??
      (photosSkipped && !g.photosDone
        ? phoneLed
          ? { tone: "warn" as Tone, title: "Not scanned", text: "The customer's phone moved on without the camera. Check the glass, back, frame and screen by eye." }
          : { tone: "muted" as Tone, title: "Photos skipped", text: "Check the glass, back and frame by eye." }
        : null);
    return (
      <Card>
        <H2>Camera AI (GradeIQ)</H2>
        <Text style={{ fontSize: 19, fontWeight: "800", color: L.muted }}>Not camera-graded</Text>
        {why ? (
          <Banner tone={why.tone} title={why.title}>
            {why.text}
          </Banner>
        ) : (
          <Body muted>
            {g.phase === "absent"
              ? "Camera grading isn't available on this server. Check the condition by eye."
              : phoneLed
                ? "The grade appears here after the scan (step 3)."
                : g.twoPass
                  ? "The grade appears here after the photos (step 1)."
                  : "The grade appears here after step 3."}
          </Body>
        )}
        {g.lcdNotChecked && g.override ? <KV label="Display (LCD)" value="Not camera-checked" tone="warn" /> : null}
        <Disagreements g={g} />
      </Card>
    );
  }

  const obstructed = !!r.obstruction?.present;
  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <H2>Camera AI (GradeIQ)</H2>
        {r.fetchedAt ? <Text style={{ color: L.muted, fontSize: 14 }}>{ago(r.fetchedAt)}</Text> : null}
      </View>

      {obstructed ? (
        <Banner tone="bad" title="Remove the case and retake">
          {`The camera saw ${r.obstruction!.type && r.obstruction!.type !== "none" ? `a ${r.obstruction!.type}` : "a case or cover"} on the phone, so this grade can't be used.${r.obstruction!.note ? ` ${r.obstruction!.note}` : ""}`}
        </Banner>
      ) : null}

      {/* The letter, and how far to trust it */}
      <View style={{ flexDirection: "row", gap: 16, alignItems: "center", opacity: obstructed ? 0.5 : 1 }}>
        <View
          style={{
            minWidth: 84,
            height: 84,
            paddingHorizontal: 10,
            borderRadius: 22,
            backgroundColor: r.final ? L.upBg : L.warnBg,
            alignItems: "center",
            justifyContent: "center",
          }}
          accessibilityLabel={`Cosmetic grade ${r.grade}, ${r.final ? "final" : "provisional"}`}
        >
          <Figure size={r.grade.length > 2 ? 24 : 44} color={r.final ? L.up : L.warn}>
            {r.grade}
          </Figure>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ fontSize: 17, fontWeight: "700", color: L.ink }}>Cosmetic grade · {GRADE_MEANING[r.grade] ?? r.grade}</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {obstructed ? <Chip text="Not used — case on the phone" tone="bad" /> : <Chip text={r.final ? "Final" : "Provisional"} tone={r.final ? "up" : "warn"} />}
            {r.conclusive === true ? <Chip text="Conclusive" tone="up" /> : null}
            {r.conclusive === false ? <Chip text={r.gradeRange ? `Range ${r.gradeRange.best}–${r.gradeRange.worst}` : "Not conclusive"} tone="warn" /> : null}
            {r.needsHumanReview ? <Chip text="Needs a person to check" tone="warn" /> : null}
          </View>
        </View>
      </View>
      {!r.final && !obstructed ? (
        <Body muted>
          {r.provisionalWhy ||
            (r.refining
              ? "The final check is still running. Confirm by eye if it doesn't finish."
              : g.capture.verdict !== "ok"
                ? "The photos haven't been accepted yet."
                : "Not final. Confirm by eye.")}
        </Body>
      ) : null}
      {r.conclusive === false && !r.flags.length ? <Body muted>{r.gradeRange ? `Camera grade ${r.gradeRange.best}–${r.gradeRange.worst}. Confirm by eye.` : "The camera couldn't settle on one grade. Confirm by eye."}</Body> : null}

      {/* Per component */}
      {r.components.length ? (
        <View style={{ gap: 4 }}>
          <Label>What the camera saw</Label>
          {r.components.map((c) => (
            <View key={c.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: L.border, gap: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                <Text style={{ fontSize: 17, fontWeight: "700", color: L.ink, flex: 1 }}>{c.name}</Text>
                <Text style={{ fontSize: 16, fontWeight: "800", color: c.grade ? L.ink : L.muted, textAlign: "right" }}>
                  {c.grade ? `${c.grade}${c.confidence !== null ? ` · ${pct(c.confidence)} sure` : ""}` : "Not seen by the camera"}
                </Text>
              </View>
              {c.findings.map((f, i) => (
                <FindingRow key={i} f={f} />
              ))}
              {c.grade && !c.findings.length ? <Text style={{ fontSize: 15, color: L.muted }}>No marks found.</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      {r.looseFindings.length ? (
        <View style={{ gap: 4 }}>
          <Label>{r.components.length ? "Other findings" : "Findings"}</Label>
          {r.looseFindings.map((f, i) => (
            <FindingRow key={i} f={f} />
          ))}
        </View>
      ) : null}

      {r.faults.length ? (
        <View style={{ gap: 4 }}>
          <Label>Camera-confirmed · added to the case at Apply</Label>
          {r.faults.map((f, i) => (
            <FaultRow key={i} f={f} tone="bad" />
          ))}
        </View>
      ) : null}
      {r.suggested.length ? (
        <View style={{ gap: 4 }}>
          <Label>Suggested · not added — check by eye</Label>
          {r.suggested.map((f, i) => (
            <FaultRow key={i} f={f} tone="warn" />
          ))}
        </View>
      ) : null}

      {/* LCD, parts, identity */}
      <View>
        <LcdRow g={g} r={r} quiet={r.flags.length > 0} screenDue={screenDue} dueAt={phoneLed ? "Checked at the scan (step 3)" : "Checked at step 4"} />
        {r.oem?.verdict === "suspect_aftermarket" ? (
          <KV label="Original parts" value={`Possibly not original${r.oem.confidence !== null ? ` (${pct(r.oem.confidence)})` : ""}`} tone="warn" />
        ) : null}
        {r.device?.match === "mismatch" ? (
          <KV label="Model in the photos" value={`${[r.device.make, r.device.model].filter(Boolean).join(" ") || "A different phone"} — doesn't match`} tone="bad" />
        ) : null}
        {r.identity?.verdict === "mismatch" ? <KV label="Identity check" value="Mismatch — don't quote" tone="bad" /> : null}
        {r.coverage !== null ? <KV label="Phone visible in photos" value={pct(r.coverage)!} tone={r.coverage < 0.5 ? "warn" : undefined} /> : null}
        {r.photos !== null ? <KV label="Photos" value={String(r.photos)} /> : null}
      </View>
      {r.flags.length ? (
        <View style={{ gap: 4 }}>
          <Label>For you to look at</Label>
          {r.flags.map((t, i) => (
            <Text key={i} style={{ fontSize: 15, lineHeight: 21, color: L.text }}>
              ⚠ {t}
            </Text>
          ))}
        </View>
      ) : (
        <>
          {r.oem?.verdict === "suspect_aftermarket" && r.oem.evidence.length ? <Body muted>Why: {r.oem.evidence.join(" · ")}</Body> : null}
          {r.device?.match === "mismatch" && r.device.reason ? <Body muted>{r.device.reason}</Body> : null}
          {r.identity?.flags.length ? <Body muted>{r.identity.flags.join(" · ")}</Body> : null}
        </>
      )}

      <Disagreements g={g} />

      <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>
        The camera grade guides you; it is never priced. The price comes from the condition recorded on the case.
      </Text>
    </Card>
  );
}

function FindingRow({ f }: { f: CameraFinding }) {
  const serious = f.type === "crack" || f.type === "deadpixel" || f.severity === "severe";
  return (
    <Text style={{ fontSize: 15, lineHeight: 21, color: serious ? L.bad : L.text }}>
      {serious ? "✕ " : "• "}
      {findingLine(f)}
    </Text>
  );
}

function FaultRow({ f, tone }: { f: CameraFault; tone: Tone }) {
  const ref = [f.confidence !== null ? pct(f.confidence) : null, f.photo !== null ? `photo ${f.photo}` : null].filter(Boolean).join(", ");
  return (
    <View style={{ gap: 2, paddingVertical: 2 }}>
      <Text style={{ fontSize: 16, fontWeight: "800", color: toneColor(tone) }}>
        {tone === "bad" ? "✕" : "?"} {faultLabel(f.id)}
        {ref && !f.because ? ` (${ref})` : ""}
      </Text>
      {f.because ? <Text style={{ fontSize: 15, color: L.muted, lineHeight: 21 }}>{f.because}</Text> : null}
    </View>
  );
}

function LcdRow({ g, r, quiet, screenDue, dueAt }: { g: CameraGrading; r: CameraResult; quiet: boolean; screenDue: boolean; dueAt: string }) {
  const d = r.display;
  // Photos first, screen last (or the scan still running): until the screen check runs there is
  // simply no LCD verdict yet — not "not checked".
  if (screenDue && !g.override && (!d || d.verdict === "unknown")) return <KV label="Display (LCD)" value={dueAt} tone="muted" />;
  if (g.lcdNotChecked) {
    return (
      <View>
        <KV label="Display (LCD)" value="Not camera-checked" tone="warn" />
        {!quiet ? <Text style={{ fontSize: 14, color: L.muted, lineHeight: 20, paddingTop: 4 }}>{g.lcdNotChecked.charAt(0).toUpperCase() + g.lcdNotChecked.slice(1)}</Text> : null}
      </View>
    );
  }
  if (!d) return <KV label="Display (LCD)" value="Not camera-checked" tone="warn" />;
  const tone: Tone = d.verdict === "pass" ? "up" : d.verdict === "fail" ? "bad" : "warn";
  const word = d.verdict === "pass" ? "No faults seen" : d.verdict === "fail" ? "Fault seen" : "No verdict";
  return (
    <View>
      <KV label="Display (LCD)" value={`${word}${d.confidence !== null ? ` · ${pct(d.confidence)}` : ""}`} tone={tone} />
      {d.findings.map((f, i) => (
        <FindingRow key={i} f={f} />
      ))}
      {d.note ? <Text style={{ fontSize: 14, color: L.muted, lineHeight: 20 }}>{d.note}</Text> : null}
    </View>
  );
}

function Disagreements({ g }: { g: CameraGrading }) {
  if (!g.disagreements.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Label>Customer, tests and camera disagree</Label>
      {g.disagreements.map((d, i) => (
        <View key={i} style={{ gap: 2, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: toneColor("warn") }}>
          <Text style={{ fontSize: 16, lineHeight: 22, color: L.ink, fontWeight: "700" }}>{disagreementLine(d)}</Text>
          {d.advice ? <Text style={{ fontSize: 15, color: L.muted, lineHeight: 21 }}>{d.advice}</Text> : null}
        </View>
      ))}
    </View>
  );
}
