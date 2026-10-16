// Step ③ on the Session screen — the advisor photographs the customer's phone
// with THIS device on GradeIQ's camera page — and the "Camera AI (GradeIQ)"
// results card. Everything shown comes from session.grading (../grading.ts);
// nothing here makes up a grade, a verdict or a reason.
import React, { useState } from "react";
import { Platform, Text, View } from "react-native";
import { L } from "../../shared/theme";
import { CameraFinding, CameraGrading, CameraResult, GRADE_MEANING, disagreementLine, findingLine, pct } from "../grading";
import { openCameraPage } from "../openCamera";
import { StaffClient, errText } from "../staffClient";
import type { TestSessionView } from "../types";
import { Banner, Body, Btn, Card, Chip, Field, H2, KV, Label, Tone, ago, toneColor } from "../ui";

const IS_WEB = Platform.OS === "web";
const MIN_REASON = 8;

// ── ③ Photograph the phone ───────────────────────────────────────────────────

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
  const [openErr, setOpenErr] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ at: number; inChrome: boolean } | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [ovBusy, setOvBusy] = useState(false);
  const [ovErr, setOvErr] = useState<string | null>(null);

  const head = (
    <View style={{ gap: 4 }}>
      <Label>Step 3 · advisor</Label>
      <H2>Photograph the phone</H2>
    </View>
  );

  // Off, failed or not offered: say so, and send the advisor to their own eyes.
  if (g.phase === "absent" || g.phase === "disabled" || g.phase === "failed") {
    const title = g.phase === "disabled" ? "Camera grading is switched off" : g.phase === "failed" ? "Camera grading unavailable" : "No camera grading on this server";
    return (
      <Card>
        {head}
        <Banner tone={g.phase === "failed" ? "bad" : "muted"} title={title}>
          {`${g.message ? `${g.message} ` : g.phase === "absent" ? "This SwapUp server doesn't offer camera grading yet. " : ""}Check the condition by eye.`}
        </Banner>
      </Card>
    );
  }

  const status = v.status;
  const graded = !!g.result?.grade;
  const joined = status === "joined" || status === "testing" || status === "complete";
  const unlocked = !!g.cameraUrl && (g.deviceReady || !!g.override);
  const movedOn = joined && !g.deviceReady && (status === "complete" || (v.progress?.done ?? 0) > 0);
  const canOverride = joined && !g.deviceReady && !g.override && (!!g.screenProblem || movedOn);

  async function takePhotos() {
    if (!g.cameraUrl) return;
    setOpenErr(null);
    const r = await openCameraPage(g.cameraUrl);
    if (r.ok) setOpened({ at: Date.now(), inChrome: r.inChrome });
    else setOpenErr(r.error);
  }

  async function sendOverride() {
    const why = reason.trim();
    if (why.length < MIN_REASON) {
      setOvErr("Say why in a few words — it goes on the case with your name.");
      return;
    }
    setOvErr(null);
    setOvBusy(true);
    try {
      const r = await api.post<unknown>(`/api/test-sessions/${encodeURIComponent(v.id)}/camera-override`, { reason: why });
      onSession(r);
      setOverrideOpen(false);
    } catch (e) {
      setOvErr(errText(e));
    } finally {
      setOvBusy(false);
    }
  }

  const guidance = (
    <View style={{ gap: 8 }}>
      {[
        "Take the case off the customer's phone.",
        "Wipe the screen and the back.",
        "Leave SwapUp Check open on the counter, screen up — the camera page tells it what to show.",
        "Follow the prompts on the camera page until it says it's done.",
      ].map((t, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: L.fixBg, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: L.fix, fontWeight: "800", fontSize: 15 }}>{i + 1}</Text>
          </View>
          <Text style={{ flex: 1, fontSize: 17, lineHeight: 24, color: L.text }}>{t}</Text>
        </View>
      ))}
    </View>
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
          title={g.deviceReady ? "Getting the camera link from SwapUp…" : "Waiting for the customer's phone to open SwapUp Check"}
          text={
            g.deviceReady
              ? "The customer's phone is ready. The button appears in a moment."
              : joined
                ? "SwapUp Check is connected but isn't showing the photo screen yet. It unlocks this step by itself once the phone is lying on the counter with SwapUp Check open."
                : "Photos come after the customer's phone joins: it shows the screen patterns the camera asks for, so the screen gets checked too."
          }
        />
        {g.screenProblem ? (
          <Banner tone="warn" title="Can't confirm the customer's phone is ready">
            {g.screenProblem}
          </Banner>
        ) : movedOn ? (
          <Banner tone="warn" title="The customer's phone has moved on to its tests">
            It isn't showing the photo screen, so the camera can't check the display. You can still photograph the outside.
          </Banner>
        ) : null}
        {canOverride ? (
          overrideOpen ? (
            <View style={{ gap: 10 }}>
              <Body>
                Without the customer's phone paired, the display is <Text style={{ fontWeight: "800" }}>not camera-checked</Text>. The photos still grade the glass, back and frame.
                Your name and reason go on the case.
              </Body>
              <Field label="Why go ahead without it?" value={reason} onChangeText={setReason} placeholder="e.g. customer's phone won't stay on the photo screen" editable={!ovBusy} error={ovErr} />
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <Btn title="Take photos without the screen check" onPress={sendOverride} busy={ovBusy} style={{ flexGrow: 1 }} />
                <Btn title="Keep waiting" kind="secondary" onPress={() => setOverrideOpen(false)} disabled={ovBusy} />
              </View>
            </View>
          ) : (
            <Btn title="Take photos anyway" kind="secondary" onPress={() => setOverrideOpen(true)} style={{ alignSelf: "flex-start" }} />
          )
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
        {wide ? (
          <View style={{ flexDirection: "row", gap: 20, alignItems: "flex-start" }}>
            <View style={{ flex: 1, minWidth: 0 }}>{guidance}</View>
            <View style={{ width: 320, gap: 10 }}>
              <OpenButton graded={graded} onPress={takePhotos} />
              <OpenedNote opened={opened} />
            </View>
          </View>
        ) : (
          <>
            {guidance}
            <OpenButton graded={graded} onPress={takePhotos} />
            <OpenedNote opened={opened} />
          </>
        )}
        {openErr ? <Banner tone="bad" title="Camera page didn't open">{openErr}</Banner> : null}
        <Progress g={g} />
      </View>
    );
  }

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        {head}
        {graded ? <Chip text={g.result!.final ? `Graded ${g.result!.grade}` : `Provisional ${g.result!.grade}`} tone={g.result!.final ? "up" : "warn"} /> : null}
      </View>
      {body}
    </Card>
  );
}

const overrideWho = (g: CameraGrading) => [g.override?.by, g.override?.reason].filter(Boolean).join(": ");

function Locked({ title, text }: { title: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start", padding: 14, borderRadius: L.radius, backgroundColor: L.surface2 }}>
      <Text style={{ fontSize: 28 }} accessibilityLabel="Locked">
        🔒
      </Text>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontSize: 18, fontWeight: "800", color: L.ink }}>{title}</Text>
        <Body muted>{text}</Body>
      </View>
    </View>
  );
}

function OpenButton({ graded, onPress }: { graded: boolean; onPress: () => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Btn title={graded ? "Retake photos" : "Take photos"} kind={graded ? "secondary" : "primary"} onPress={onPress} big />
      <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>
        {IS_WEB
          ? "Opens the camera page in a new tab. Chrome on an Android tablet takes the torch-lit photos."
          : "Opens the camera page in Chrome on this device. Come back here when it says it's done."}
      </Text>
    </View>
  );
}

function OpenedNote({ opened }: { opened: { at: number; inChrome: boolean } | null }) {
  if (!opened) return null;
  return (
    <Text style={{ color: opened.inChrome ? L.muted : L.warn, fontSize: 14, lineHeight: 20, fontWeight: opened.inChrome ? "400" : "700" }}>
      {opened.inChrome
        ? `Camera page opened ${ago(new Date(opened.at).toISOString()) || "just now"}.`
        : IS_WEB
          ? "Opened in this browser. Without Chrome on Android there are no torch-lit photos."
          : "Chrome isn't on this device, so the camera page opened in the default browser — no torch-lit photos."}
    </Text>
  );
}

/** camera connected → photos uploaded → capture ok / retake → grading… → graded. */
function Progress({ g }: { g: CameraGrading }) {
  const c = g.capture;
  const r = g.result;
  const uploaded = c.cosmeticDone || !!c.verdict || !!r;
  const steps: { label: string; state: "done" | "now" | "todo" | "bad"; detail?: string }[] = [
    { label: "Camera connected", state: c.connectedAt ? "done" : "now", detail: c.connectedAt ? ago(c.connectedAt) || undefined : "Waiting for the camera page" },
    { label: "Photos uploaded", state: uploaded ? "done" : c.connectedAt ? "now" : "todo" },
    c.verdict === "retake"
      ? { label: "Photos rejected — retake", state: "bad", detail: c.reasons.length ? c.reasons.join(" · ") : "The camera page says what to retake." }
      : { label: "Photos accepted", state: c.verdict === "ok" ? "done" : uploaded ? "now" : "todo" },
    {
      label: r?.grade ? (r.final ? `Graded ${r.grade}` : `Provisional ${r.grade}${r.refining ? " — final check running" : ""}`) : r && r.tierUsed === "stub" ? "Grading failed" : "Grading…",
      state: r?.grade ? (r.final ? "done" : "now") : r && r.tierUsed === "stub" ? "bad" : c.verdict === "ok" || c.cosmeticDone ? "now" : "todo",
      detail: r && r.tierUsed === "stub" ? "Check the condition by eye." : !r?.grade && (c.verdict === "ok" || c.cosmeticDone) ? "Usually 10–30 seconds." : undefined,
    },
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
  if (g.phase === "disabled") return { tone: "muted", title: "Camera grading is switched off", text: `${g.message ? `${g.message} ` : ""}Check the condition by eye.` };
  if (g.phase === "failed") return { tone: "bad", title: "Camera grading failed", text: `${g.message ? `${g.message} ` : ""}Check the condition by eye.` };
  if (r?.obstruction?.present) return { tone: "bad", title: "Remove the case and retake", text: `The camera saw ${r.obstruction.type && r.obstruction.type !== "none" ? `a ${r.obstruction.type}` : "a case or cover"} on the phone.${r.obstruction.note ? ` ${r.obstruction.note}` : ""}` };
  if (g.capture.verdict === "retake") return { tone: "warn", title: "Photos rejected — retake", text: g.capture.reasons.length ? g.capture.reasons.join(" · ") : "The camera page says what to retake." };
  if (r && r.tierUsed === "stub") return { tone: "bad", title: "Camera grading failed", text: "GradeIQ couldn't grade these photos. Check the condition by eye." };
  if (r && r.coverage !== null && r.coverage < 0.5) return { tone: "warn", title: "Not enough of the phone was visible", text: `The camera saw ${pct(r.coverage)} of the phone. Retake the photos.` };
  if (g.capture.cosmeticDone || g.capture.verdict === "ok") return { tone: "fix", title: "Grading…", text: "The photos are in. The grade usually lands in 10–30 seconds." };
  return null;
}

export function CameraAiCard({ g }: { g: CameraGrading }) {
  const r = g.result;
  if (!r || !r.grade) {
    const why = noGradeWhy(g);
    return (
      <Card>
        <H2>Camera AI (GradeIQ)</H2>
        <Text style={{ fontSize: 19, fontWeight: "800", color: L.muted }}>Not camera-graded</Text>
        {why ? (
          <Banner tone={why.tone} title={why.title}>
            {why.text}
          </Banner>
        ) : (
          <Body muted>{g.phase === "absent" ? "Camera grading isn't available on this server. Check the condition by eye." : "The grade appears here after step 3."}</Body>
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
            borderRadius: 18,
            backgroundColor: r.final ? L.upBg : L.warnBg,
            alignItems: "center",
            justifyContent: "center",
          }}
          accessibilityLabel={`Cosmetic grade ${r.grade}, ${r.final ? "final" : "provisional"}`}
        >
          <Text style={{ fontSize: r.grade.length > 2 ? 24 : 44, fontWeight: "900", color: r.final ? L.up : L.warn }}>{r.grade}</Text>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ fontSize: 17, fontWeight: "700", color: L.ink }}>Cosmetic grade · {GRADE_MEANING[r.grade] ?? r.grade}</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Chip text={r.final ? "Final" : "Provisional"} tone={r.final ? "up" : "warn"} />
            {r.conclusive === true ? <Chip text="Conclusive" tone="up" /> : null}
            {r.conclusive === false ? <Chip text={r.gradeRange ? `Range ${r.gradeRange.best}–${r.gradeRange.worst}` : "Not conclusive"} tone="warn" /> : null}
            {r.needsHumanReview ? <Chip text="Needs a person to check" tone="warn" /> : null}
          </View>
        </View>
      </View>
      {!r.final ? (
        <Body muted>
          {r.provisionalWhy ||
            (r.refining
              ? "The final check is still running. Confirm by eye if it doesn't finish."
              : g.capture.verdict !== "ok"
                ? "The photos haven't been accepted yet."
                : "Not final. Confirm by eye.")}
        </Body>
      ) : null}
      {r.conclusive === false ? <Body muted>{r.gradeRange ? `Camera grade ${r.gradeRange.best}–${r.gradeRange.worst}. Confirm by eye.` : "The camera couldn't settle on one grade. Confirm by eye."}</Body> : null}

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

      {/* LCD, parts, identity */}
      <View>
        <LcdRow g={g} r={r} />
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
      {r.oem?.verdict === "suspect_aftermarket" && r.oem.evidence.length ? <Body muted>Why: {r.oem.evidence.join(" · ")}</Body> : null}
      {r.device?.match === "mismatch" && r.device.reason ? <Body muted>{r.device.reason}</Body> : null}
      {r.identity?.flags.length ? <Body muted>{r.identity.flags.join(" · ")}</Body> : null}

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

function LcdRow({ g, r }: { g: CameraGrading; r: CameraResult }) {
  const d = r.display;
  if (g.lcdNotChecked) {
    return (
      <View>
        <KV label="Display (LCD)" value="Not camera-checked" tone="warn" />
        <Text style={{ fontSize: 14, color: L.muted, lineHeight: 20, paddingTop: 4 }}>{g.lcdNotChecked}</Text>
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
