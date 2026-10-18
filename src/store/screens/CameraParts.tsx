// The advisor's ONE camera step on the Session screen (step 3) — GradeIQ's camera page on
// THIS device, photos and the colour sweep in one pass. Everything shown comes from
// session.grading (../grading.ts); nothing here makes up a grade, a verdict or a reason.
//
//   ScanStepCard   — the phone-led flow (docs/PHONE-LED-FLOW.md, SwapUp Check 0.6.0+): the
//                    customer's phone shows GradeIQ's camera link as a QR; this tablet's camera
//                    app scans it, and the camera page photographs the phone and sweeps its
//                    screen in one pass. "Take photos" opens the same page from here (cameraUrl —
//                    the same fail-closed gate and override). The phone waits there for the
//                    camera — the customer is never offered a skip — so "Go on without the
//                    camera" (by name) is the advisor's to tap.
//   CameraStepCard — an older SwapUp Check (tests first, photo screen last): the same single
//                    pass (cameraUrl), unlocked once the phone is on its photo screen.
// Where the camera couldn't decide, "Check the phone" (./CertifyCard) sits INSIDE this card
// (the Session screen passes it as `certify`) — never a step of its own (owner, 2026-10-17:
// "Reduce the flow"). The answer then opens by itself after the last tap.
import React, { useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { CameraGrading } from "../grading";
import { type PhonePhase, type ScanStage, screenUnchecked } from "../phoneLed";
import { openCameraPage, openInDefaultBrowser } from "../openCamera";
import { StaffClient, errText } from "../staffClient";
import type { TestSessionView } from "../types";
import Svg, { Path, Rect } from "react-native-svg";
import { Banner, Body, Btn, Card, Chip, Field, H2, Label, ago, L } from "../ui";

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

/** The server's sentence, ending with the advice to check by eye exactly once — still one sentence. */
export function byEye(msg: string | null | undefined): string {
  const m = (msg ?? "").trim();
  return /by eye/i.test(m) ? m : m ? `${m.replace(/\.?$/, "")} — check by eye.` : "Check by eye.";
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
      setErr("Say why in a few words.");
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
      <Field label="Reason" value={reason} onChangeText={setReason} placeholder={placeholder} editable={!busy} error={err} />
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Btn title={confirmTitle} onPress={send} busy={busy} style={{ flexGrow: 1 }} />
        <Btn title="Keep waiting" kind="secondary" onPress={() => setOpen(false)} disabled={busy} />
      </View>
    </View>
  );
}

/**
 * "Continue without camera": the customer's phone, waiting on its scan screen, goes on to
 * its tests (POST …/release-scan — the server shows it `released` on /api/device/screen).
 * One tap; the server records who. The camera can still come later ("Take photos anyway"),
 * and "Check the phone", in this same step, certifies the rest after the phone's tests.
 */
function ReleaseBox({ v, api, onSession }: { v: TestSessionView; api: StaffClient; onSession: (r: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send() {
    setErr(null);
    setBusy(true);
    try {
      onSession(await api.post<unknown>(`/api/test-sessions/${encodeURIComponent(v.id)}/release-scan`, {}));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 6 }}>
      <Btn title="Continue without camera" kind="secondary" onPress={() => void send()} busy={busy} style={{ alignSelf: "flex-start" }} />
      <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>You then check the screen and body by eye.</Text>
      {err ? <Banner tone="bad" title="The phone didn't move on">{err}</Banner> : null}
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
  // No camera letter here: the one grade the counter shows is the SwapUp grade, on the answer.
  if (g.result?.grade) return <Chip text={g.result.final ? "Graded" : "Provisional"} tone={g.result.final ? "up" : "warn"} />;
  return null;
}

/** Off, failed or not offered: say so, and send the advisor to their own eyes. */
function NoCamera({ v, g, retry }: { v: TestSessionView; g: CameraGrading; retry: ReturnType<typeof useRetry> }) {
  const title = g.phase === "disabled" ? "Camera grading off" : g.phase === "failed" ? "Camera grading unavailable" : "No camera grading";
  return (
    <>
      <Banner
        tone={g.phase === "failed" ? "bad" : "muted"}
        title={title}
        action={g.canRetry && !TERMINAL_STATUSES.has(v.status) ? { title: "Retry", onPress: retry.retry, busy: retry.busy } : undefined}
      >
        {byEye(g.message)}
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
        {IS_WEB ? "Opens in a new tab." : "Opens in Chrome — come back when it's done."}
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
          ? `Opened ${ago(new Date(opened.at).toISOString()) || "just now"}.`
          : IS_WEB
            ? "No torch photos outside Chrome on Android."
            : "Opened without Chrome — no torch photos."}
      </Text>
      {/* If Chrome came up without GradeIQ's camera page, the plain browser hand-off always works. */}
      {opened.inChrome && !IS_WEB && onPlain ? (
        <Btn title="Open in browser" kind="ghost" onPress={() => onPlain(opened.url)} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} />
      ) : null}
    </View>
  );
}

// ── an older SwapUp Check: Step 3 · Photograph the phone (one pass, after its tests) ──

export function CameraStepCard({
  v,
  g,
  api,
  wide,
  onSession,
  certify,
  now,
}: {
  v: TestSessionView;
  g: CameraGrading;
  api: StaffClient;
  wide: boolean;
  /** The override answered with a fresh session (or a fresh grading object). */
  onSession: (r: unknown) => void;
  /** "Check the phone", when the camera couldn't decide — inside this step. */
  certify?: React.ReactNode;
  /** This is the step the advisor is on: outlined. */
  now?: boolean;
}) {
  const gate = usePhoneGate(v, g);
  const retry = useRetry(api, v, onSession);
  const opener = useOpener();
  const head = <StepHead label="Step 3 · advisor" title="Photograph the phone" chip={gradeChip(g)} />;

  if (g.phase === "absent" || g.phase === "disabled" || g.phase === "failed") {
    return (
      <Card style={{ gap: 14, ...(now ? NOW_BORDER : null) }}>
        <StepHead label="Step 3 · advisor" title="Photograph the phone" />
        <NoCamera v={v} g={g} retry={retry} />
        {certify}
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
        "Take the case off.",
        "Wipe the screen and back.",
        "Lay it screen up, SwapUp Check open.",
        "Follow the camera page.",
      ]}
    />
  );

  let body: React.ReactNode;
  if (status === "expired" || status === "cancelled") {
    body = <Body muted>{graded ? "Photos taken." : "No photos — the test ended first."}</Body>;
  } else if (status === "applied") {
    body = <Body muted>{graded ? "Photos taken." : "No photos taken."}</Body>;
  } else if (g.phase === "pending") {
    body = (
      <Banner tone="muted" title="Setting up the camera…">
        {g.message || undefined}
      </Banner>
    );
  } else if (!unlocked) {
    // Locked until the customer's phone is echoing the camera's patterns (fail closed).
    body = (
      <View style={{ gap: 12 }}>
        <Locked
          title={
            g.deviceReady
              ? "Getting the camera link…"
              : g.screenProblem
                ? "Can't confirm the phone is ready"
                : testing
                  ? "Phone is running its tests"
                  : joined
                    ? "Waiting for the photo screen"
                    : "Waiting for SwapUp Check"
          }
          text={
            g.screenProblem ??
            // Moved on before finishing (stopped, or an app that never shows the photo screen): our own words —
            // the server's sentence may still say the screen is coming.
            (movedOn && status !== "complete"
              ? photosLast
                ? "The phone went quiet — ask the customer to reopen SwapUp Check."
                : "This check has no photo screen — take photos anyway."
              : null) ??
            g.cameraLocked ??
            (g.deviceReady
              ? "The button appears in a moment."
              : testing
                ? "Unlocks by itself after the tests."
                : joined
                  ? "Unlocks when the phone shows its photo screen."
                  : "Photos come after the tests.")
          }
        />
        {g.screenProblem ? null : movedOn ? (
          <Banner tone="warn" title={status === "complete" ? "Finished without photos" : "Phone moved on"}>
            Photos now cover the outside only.
          </Banner>
        ) : null}
        {canOverride ? (
          <OverrideBox
            v={v}
            api={api}
            onSession={onSession}
            openTitle="Take photos anyway"
            confirmTitle="Photos only"
            placeholder="e.g. phone left the photo screen"
            explain={
              <>
                Screen <Text style={{ fontWeight: "800" }}>not camera-checked</Text>; your name goes on the case.
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
          <Banner tone="warn" title="Screen not camera-checked">
            {`${overrideWho(g) || "Override"} — check the screen by eye.`}
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
    <Card style={{ gap: 14, ...(now ? NOW_BORDER : null) }}>
      {head}
      {body}
      {certify}
    </Card>
  );
}

/** The step the advisor is on. */
const NOW_BORDER = { borderColor: L.fix, borderWidth: 2 } as const;

const OutOfSync = () => <Text style={{ color: L.muted, fontSize: 14 }}>Camera out of sync — retrying.</Text>;

const overrideWho = (g: CameraGrading) => [g.override?.by, g.override?.reason].filter(Boolean).join(": ");

// ── phone-led: Step 3 · Scan the customer's phone (photos + colour sweep, one pass) ──

const SCAN_HINT = "Scan the code on the phone.";

export function ScanStepCard({
  v,
  g,
  api,
  wide,
  phase,
  stage,
  onSession,
  certify,
  now,
}: {
  v: TestSessionView;
  g: CameraGrading;
  api: StaffClient;
  wide: boolean;
  phase: PhonePhase | null;
  /** ../phoneLed.ts scanStage(), worked out once by the Session screen. */
  stage: ScanStage;
  onSession: (r: unknown) => void;
  /** "Check the phone", when the camera couldn't decide — inside this step. */
  certify?: React.ReactNode;
  /** This is the step the advisor is on: outlined. */
  now?: boolean;
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

  // Scanned, but the screen itself wasn't camera-checked: say that, not a plain "Scanned".
  const unchecked = screenUnchecked(stage, g);
  const chip =
    stage === "now" ? (
      (gradeChip(g) ?? <Chip text={g.capture.connected ? "Scanning" : "Scan now"} tone="fix" />)
    ) : stage === "done" ? (
      unchecked ? <Chip text="Screen not checked" tone="warn" /> : (gradeChip(g) ?? <Chip text="Scanned" tone="up" />)
    ) : stage === "skipped" ? (
      <Chip text={g.released ? "Camera skipped" : "Not scanned"} tone="warn" />
    ) : null;
  const head = <StepHead label="Step 3 · advisor" title="Scan the customer's phone" chip={chip} />;

  const override = canOverride ? (
    <OverrideBox
      v={v}
      api={api}
      onSession={onSession}
      openTitle="Take photos anyway"
      confirmTitle="Photos only"
      placeholder={stage === "skipped" ? "e.g. went on without the scan" : "e.g. code shown, still locked"}
      explain={
        <>
          Screen <Text style={{ fontWeight: "800" }}>not camera-checked</Text>; your name goes on the case.
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
  // The phone is waiting on its scan screen; only the advisor lets it go without the camera.
  const release = g.canRelease && (stage === "now" || stage === "setup") ? <ReleaseBox v={v} api={api} onSession={onSession} /> : null;
  const overrideNote = g.override ? (
    <Banner tone="warn" title="Screen not camera-checked">
      {`${overrideWho(g) || "Override"} — check the screen by eye.`}
    </Banner>
  ) : null;

  let body: React.ReactNode;
  if (stage === "off") {
    body = (
      <>
        <NoCamera v={v} g={g} retry={retry} />
        {phase === "scan" ? <Body muted>Check the screen and body by eye after the tests.</Body> : null}
      </>
    );
  } else if (stage === "setup") {
    body = (
      <View style={{ gap: 12 }}>
        <Banner tone="muted" title="Setting up the camera…">
          {g.message || undefined}
        </Banner>
        {release}
      </View>
    );
  } else if (stage === "waiting") {
    body = (
      <View style={{ gap: 12 }}>
        <Locked
          title={joined ? "Phone is identifying itself" : "Waiting for the phone"}
          text={joined ? "Next it shows a QR to scan." : "Connect it first (step 2)."}
        />
        <Body muted>Meanwhile: case off, wipe the screen and back.</Body>
      </View>
    );
  } else if (stage === "now") {
    body = (
      <View style={{ gap: 14 }}>
        {overrideNote}
        {g.screenProblem && !g.override ? (
          <Banner tone="warn" title="Can't confirm the phone is ready">
            {g.screenProblem}
          </Banner>
        ) : g.capture.connected ? (
          <Banner tone="fix" title="Camera connected — keep still" />
        ) : (
          <Banner tone="fix" title="Phone shows its scan code" />
        )}
        <GuideAndButton
          wide={wide}
          guide={
            <Numbered
              items={[
                "Case off; wipe the screen and back.",
                "Scan its QR with this tablet's camera.",
                "Follow the camera page.",
                "Hold still until it says done.",
              ]}
            />
          }
          button={
            unlocked ? (
              <>
                <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>QR won't scan? Open it from here.</Text>
                {takePhotos(false)}
              </>
            ) : (
              // Our own sentence, not g.cameraLocked: here the lock only means SwapUp hasn't seen the
              // phone's scan screen yet, and the QR route doesn't wait for SwapUp at all.
              <Body muted>“Take photos” appears here soon.</Body>
            )
          }
        />
        {openErr}
        <Progress g={g} connectHint={SCAN_HINT} />
        {g.outOfSync ? <OutOfSync /> : null}
        {override}
        {release}
      </View>
    );
  } else if (stage === "done") {
    body = (
      <View style={{ gap: 12 }}>
        <Body>
          {!unchecked ? "Photos and screen check done." : g.screenDone ? "The camera couldn't check the screen — check it below." : "Screen not checked — check it below."}
        </Body>
        {g.override ? <Body muted>{`Override${overrideWho(g) ? ` (${overrideWho(g)})` : ""} — screen not camera-checked.`}</Body> : null}
        <Progress g={g} connectHint={SCAN_HINT} />
        {g.outOfSync ? <OutOfSync /> : null}
        {unlocked && (needRetake || onScan) ? (
          <View style={{ gap: 6, alignSelf: "flex-start" }}>
            {!onScan ? <Body muted>A retake now covers the outside only.</Body> : null}
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
                "Case off; wipe the screen and back.",
                "Follow the camera page until done.",
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
        <Banner
          tone="warn"
          title={
            g.released
              ? `Camera skipped${g.released.by ? ` (${g.released.by})` : ""}`
              : v.status === "complete"
                ? "Finished without the scan"
                : "Moved on without the scan"
          }
        >
          Check the phone below after its tests.
        </Banner>
        {override}
      </View>
    );
  }

  return (
    <Card style={{ gap: 14, ...(now ? NOW_BORDER : null) }}>
      {head}
      {body}
      {certify}
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
  if (c.verdict === "retake") return { label: "Grade", state: "todo", detail: "Needs accepted photos." };
  if (r?.obstruction?.present) return { label: "Remove the case, retake", state: "bad", detail: "These photos aren't graded." };
  if (r?.grade) return r.final ? { label: "Graded", state: "done" } : { label: "Graded — provisional", state: "now", detail: r.provisionalWhy ?? why };
  if (r && (r.tierUsed === "stub" || r.status === "failed")) return { label: "Grading failed", state: "bad", detail: byEye(why) };
  if (g.timedOut) return { label: "No grade came back", state: "bad", detail: byEye(why) };
  if (r?.status === "grading" || c.verdict === "ok" || c.cosmeticDone) return { label: "Grading…", state: "now", detail: "Usually 10–30 s." };
  return { label: "Grade", state: "todo" };
}

function Progress({ g, connectHint = "Tap “Take photos”." }: { g: CameraGrading; connectHint?: string }) {
  const c = g.capture;
  const r = g.result;
  const uploaded = c.cosmeticDone || !!c.verdict || !!r?.grade;
  const steps: Step[] = [
    c.connected
      ? { label: "Camera connected", state: "done", detail: c.connectedAt ? ago(c.connectedAt) || undefined : undefined }
      : { label: "Camera not connected", state: "now", detail: connectHint },
    { label: "Photos uploaded", state: uploaded ? "done" : c.connected ? "now" : "todo" },
    c.verdict === "retake"
      ? { label: "Photos rejected — retake", state: "bad", detail: c.reasons.length ? c.reasons.join(" · ") : "See the camera page." }
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
