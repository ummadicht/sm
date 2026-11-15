// "Testing your phone…" — one progress bar and a list that ticks itself.
// Runs the automatic steps in order (./plan AUTO_ORDER), hands every verdict to
// onResult (the Check engine's outbox: disk first, then the store), and never
// asks the customer anything. The only line it may show is a physical action
// ("Hold the phone up") when a camera saw nothing.
// Any step that does not complete is retried up to 3 times; if it still cannot
// complete after 3 attempts, it is reported as not working / issue with component detection.
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { RecordingPresets, useAudioRecorder } from "expo-audio";
import { P } from "../../shared/theme";
import { Card, Headline, Lead, ProgressBar } from "../../shared/kit";
import type { Detail, Outcome, Verdict } from "./analysis";
import { type AutoStepId, autoSteps } from "./plan";
import { COMPONENT_DETECTION_ISSUE, MAX_TEST_ATTEMPTS, formatFailureVerdict, runWithThreeTries } from "./retry";
import { batteryStep, connectivityStep, faceidStep, featureStep, motionStep, sensorsStep, sleep, vibrationStep, within } from "./steps";
import { resetAudioMode, speakerMicStep, voiceStep } from "./audio";
import { cameraStep, flashStep, useCameraRig } from "./camera";

export type Existing = Record<string, { outcome: Outcome; detail: Detail | null } | undefined>;

type Props = {
  /** Every automatic test of this check, in run order (rows of the list). */
  all: string[];
  /** The ones to run now (missing on a resume, or a re-run from the Done screen). */
  todo: string[];
  names: Record<string, string>;
  /** Results already on the phone (ticked rows, and what the earpiece check compares against). */
  existing: Existing;
  onResult: (id: string, outcome: Outcome, detail: Detail) => void;
  onDone: () => void;
  /** Rendered above the list (the "sent to the store" badge). */
  status?: React.ReactNode;
};

/** A step that hangs must not hang the check; its tests retry up to 3 times. */
const STEP_TIMEOUT_MS: Partial<Record<AutoStepId, number>> = { camera: 60_000, flash: 30_000, loopback: 25_000, voice: 25_000, connectivity: 25_000 };

const timedOut = (step: AutoStepId): Verdict => ({ outcome: "skip", detail: { method: "timeout", reason: `the ${step} check did not finish in time` } });

export function AutoRunner({ all, todo, names, existing, onResult, onDone, status }: Props) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const rig = useCameraRig();
  const rigRef = useRef(rig);
  rigRef.current = rig;
  const [running, setRunning] = useState<string[]>([]);
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [local, setLocal] = useState<Record<string, Outcome>>({});
  const [localDetail, setLocalDetail] = useState<Record<string, Detail | null>>({});
  const [line, setLine] = useState<string | null>(null);
  const props = useRef({ existing, onResult, onDone });
  props.current = { existing, onResult, onDone };

  useEffect(() => {
    let alive = true;
    const record = (id: string, v: Verdict) => {
      if (!alive) return;
      setLocal((m) => ({ ...m, [id]: v.outcome }));
      setLocalDetail((m) => ({ ...m, [id]: v.detail }));
      props.current.onResult(id, v.outcome, v.detail);
    };
    const wants = (id: string) => todo.includes(id);
    // Rig methods are stable; the proxy keeps steps talking to the current render's rig.
    const rigProxy = {
      open: (f: "back" | "front") => rigRef.current.open(f),
      setTorch: (on: boolean) => rigRef.current.setTorch(on),
      frame: () => rigRef.current.frame(),
      close: () => rigRef.current.close(),
      get view() {
        return rigRef.current.view;
      },
    };
    let micWorks = props.current.existing.mic?.outcome === "pass";
    const prevSpeakerOn = props.current.existing.speaker?.detail?.onDb;
    let speakerOnDb: number | null = props.current.existing.speaker?.outcome === "pass" && typeof prevSpeakerOn === "number" ? prevSpeakerOn : null;

    const markTry = (ids: string[], n: number) => {
      if (!alive) return;
      setAttempts((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = n;
        return next;
      });
    };

    const runStepWithRetry = async (step: AutoStepId, ids: string[], fn: () => Promise<Verdict>) => {
      markTry(ids, 1);
      return runWithThreeTries(
        async () => within(fn(), STEP_TIMEOUT_MS[step] ?? 15_000, timedOut(step)),
        async (nextAttempt) => {
          if (!alive) return;
          if (step === "loopback" || step === "voice") await resetAudioMode();
          if (step === "camera" || step === "flash") rigRef.current.close();
          markTry(ids, nextAttempt);
          await sleep(400);
        }
      );
    };

    (async () => {
      for (const step of autoSteps(todo)) {
        if (!alive) return;
        const ids = step === "loopback" ? ["speaker", "mic"].filter(wants) : [step];
        setRunning(ids);
        try {
          switch (step) {
            case "battery":
              record("battery", await runStepWithRetry(step, ids, () => batteryStep()));
              break;
            case "sensors":
              record("sensors", await runStepWithRetry(step, ids, () => sensorsStep()));
              break;
            case "motion":
              record("motion", await runStepWithRetry(step, ids, () => motionStep()));
              break;
            case "connectivity":
              record("connectivity", await runStepWithRetry(step, ids, () => connectivityStep()));
              break;
            case "vibration":
              record("vibration", await runStepWithRetry(step, ids, () => vibrationStep()));
              break;
            case "loopback": {
              let lastMic: Verdict = timedOut(step);
              let lastSpeaker: Verdict = timedOut(step);
              for (let attempt = 1; attempt <= MAX_TEST_ATTEMPTS; attempt++) {
                if (!alive) break;
                markTry(ids, attempt);
                const r = await within(speakerMicStep(recorder), STEP_TIMEOUT_MS[step] ?? 25_000, {
                  mic: timedOut(step),
                  speaker: timedOut(step),
                  speakerOnDb: null,
                });
                lastMic = { outcome: r.mic.outcome, detail: { ...(r.mic.detail ?? {}), attempts: attempt } };
                lastSpeaker = { outcome: r.speaker.outcome, detail: { ...(r.speaker.detail ?? {}), attempts: attempt } };
                if (r.speakerOnDb != null) speakerOnDb = r.speakerOnDb;
                const micOk = !wants("mic") || r.mic.outcome === "pass" || r.mic.outcome === "unsupported";
                const spkOk = !wants("speaker") || r.speaker.outcome === "pass" || r.speaker.outcome === "unsupported";
                if (micOk && spkOk) break;
                if (attempt < MAX_TEST_ATTEMPTS) {
                  await resetAudioMode();
                  await sleep(400);
                }
              }
              const finalMic =
                lastMic.outcome === "pass" || lastMic.outcome === "unsupported"
                  ? lastMic
                  : formatFailureVerdict(lastMic, MAX_TEST_ATTEMPTS);
              const finalSpeaker =
                lastSpeaker.outcome === "pass" || lastSpeaker.outcome === "unsupported"
                  ? lastSpeaker
                  : formatFailureVerdict(lastSpeaker, MAX_TEST_ATTEMPTS);
              micWorks = finalMic.outcome === "pass";
              if (wants("mic")) record("mic", finalMic);
              if (wants("speaker")) record("speaker", finalSpeaker);
              break;
            }
            case "voice":
              record("voice", await runStepWithRetry(step, ids, () => voiceStep(recorder, micWorks, speakerOnDb)));
              break;
            case "flash":
              record("flash", await runStepWithRetry(step, ids, () => flashStep(rigProxy)));
              break;
            case "camera":
              record("camera", await runStepWithRetry(step, ids, () => cameraStep(rigProxy, (l) => alive && setLine(l))));
              break;
            case "faceid":
              record("faceid", await runStepWithRetry(step, ids, () => faceidStep()));
              break;
            case "bluetooth":
            case "nfc":
              record(step, await runStepWithRetry(step, ids, () => featureStep(step)));
              break;
          }
        } catch (e) {
          const reason = `the check stopped unexpectedly: ${String((e as Error)?.message ?? e).slice(0, 160)}`;
          for (const id of ids) {
            record(id, formatFailureVerdict({ outcome: "skip", detail: { method: "error", reason } }, MAX_TEST_ATTEMPTS));
          }
        } finally {
          if (step === "loopback" || step === "voice") await resetAudioMode();
          if (step === "camera" || step === "flash") rigRef.current.close();
        }
      }
      if (!alive) return;
      setRunning([]);
      await sleep(900); // let the last tick be seen
      if (alive) props.current.onDone();
    })();
    return () => {
      alive = false;
      rigRef.current.close();
      void resetAudioMode();
    };
    // Runs once per mount; a re-run remounts with a new `todo`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outcomeOf = (id: string): Outcome | "running" | "waiting" =>
    running.includes(id) ? "running" : local[id] ?? (todo.includes(id) ? "waiting" : existing[id]?.outcome ?? "waiting");
  const detailOf = (id: string): Detail | null | undefined => localDetail[id] ?? existing[id]?.detail;
  const done = all.filter((id) => {
    const o = outcomeOf(id);
    return o !== "running" && o !== "waiting";
  }).length;
  const pct = all.length ? done / all.length : 1;

  return (
    <View style={s.root}>
      <View style={s.head}>
        <Headline>Testing your phone…</Headline>
        <Lead>Leave it on the counter.</Lead>
        <ProgressBar value={pct} style={{ marginTop: 22 }} />
        <View style={s.barRow}>
          <Text style={s.count}>
            {done} of {all.length}
          </Text>
          <View style={{ flexShrink: 1 }}>{status}</View>
        </View>
      </View>
      {line ? (
        <View style={s.action} accessibilityRole="alert">
          <Text style={s.actionText}>{line}</Text>
        </View>
      ) : null}
      <View style={s.camRow}>{rig.view}</View>
      <ScrollView contentContainerStyle={s.scroll}>
        <Card pad={false} style={s.list}>
          {all.map((id, i) => (
            <Row
              key={id}
              name={names[id] ?? id}
              state={outcomeOf(id)}
              attempt={attempts[id] ?? 1}
              detail={detailOf(id)}
              last={i === all.length - 1}
            />
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

function Row({
  name,
  state,
  attempt,
  detail,
  last,
}: {
  name: string;
  state: Outcome | "running" | "waiting";
  attempt: number;
  detail?: Detail | null;
  last: boolean;
}) {
  const isDetectionIssue =
    state === "fail" &&
    (detail?.componentStatus === COMPONENT_DETECTION_ISSUE || Number(detail?.attempts) >= MAX_TEST_ATTEMPTS);
  const runningLabel = attempt > 1 ? `Checking (try ${attempt}/${MAX_TEST_ATTEMPTS})…` : "Checking…";
  const [mark, color, bg, word] =
    state === "pass" ? ["✓", P.pass, P.passBg, "Working"]
    : state === "fail" ? ["✗", P.fail, P.failBg, isDetectionIssue ? "Not working / component detection issue" : "Problem found"]
    : state === "skip" ? ["–", P.warn, P.warnBg, "Not tested"]
    : state === "unsupported" ? ["–", P.muted, P.surface2, "Not on this phone"]
    : state === "running" ? ["", P.primary, "transparent", runningLabel]
    : ["", P.faint, "transparent", ""];
  return (
    <View style={[s.row, last && { borderBottomWidth: 0 }]}>
      <View style={[s.mark, { backgroundColor: bg }, state === "waiting" && s.markWaiting]}>
        {state === "running" ? <ActivityIndicator size="small" color={P.primary} /> : <Text style={[s.markText, { color }]}>{mark}</Text>}
      </View>
      <Text style={[s.name, state === "waiting" && { color: P.faint }]}>{name}</Text>
      <Text style={[s.word, { color }]}>{word}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.bg },
  head: { paddingHorizontal: P.gutter, paddingTop: 28, paddingBottom: 14 },
  barRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 },
  count: { color: P.ink, fontSize: 15, fontWeight: "700" },
  action: { marginHorizontal: P.gutter, marginBottom: 10, paddingVertical: 14, paddingHorizontal: 16, borderRadius: P.radiusSm, backgroundColor: P.warnBg },
  actionText: { color: P.ink, fontSize: 18, fontWeight: "700", lineHeight: 25, textAlign: "center" },
  camRow: { alignItems: "center" },
  scroll: { paddingHorizontal: P.gutter, paddingTop: 6, paddingBottom: 30 },
  list: { paddingHorizontal: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.line },
  mark: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  markWaiting: { borderWidth: 1.5, borderColor: P.line },
  markText: { fontSize: 15, fontWeight: "800" },
  name: { flex: 1, color: P.ink, fontSize: 16, fontWeight: "600" },
  word: { fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
});
