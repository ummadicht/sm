// "Testing your phone…" — one progress bar and a list that ticks itself.
// Runs the automatic steps in order (./plan AUTO_ORDER), hands every verdict to
// onResult (the Check engine's outbox: disk first, then the store), and never
// asks the customer anything. The only line it may show is a physical action
// ("Hold the phone up") when a camera saw nothing.
// Native only. Look: the kit's headline and sentence, a thin blue bar, and the
// list on a white card (theme P).
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { RecordingPresets, useAudioRecorder } from "expo-audio";
import { P } from "../../shared/theme";
import { Card, Headline, Lead, ProgressBar } from "../../shared/kit";
import type { Detail, Outcome, Verdict } from "./analysis";
import { type AutoStepId, autoSteps } from "./plan";
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

/** A step that hangs must not hang the check; its tests become "not tested". */
const STEP_TIMEOUT_MS: Partial<Record<AutoStepId, number>> = { camera: 60_000, flash: 30_000, loopback: 25_000, voice: 25_000, connectivity: 25_000 };

const timedOut = (step: AutoStepId): Verdict => ({ outcome: "skip", detail: { method: "timeout", reason: `the ${step} check did not finish in time` } });

export function AutoRunner({ all, todo, names, existing, onResult, onDone, status }: Props) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const rig = useCameraRig();
  const rigRef = useRef(rig);
  rigRef.current = rig;
  const [running, setRunning] = useState<string[]>([]);
  const [local, setLocal] = useState<Record<string, Outcome>>({});
  const [line, setLine] = useState<string | null>(null);
  const props = useRef({ existing, onResult, onDone });
  props.current = { existing, onResult, onDone };

  useEffect(() => {
    let alive = true;
    const record = (id: string, v: Verdict) => {
      if (!alive) return;
      setLocal((m) => ({ ...m, [id]: v.outcome }));
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

    (async () => {
      for (const step of autoSteps(todo)) {
        if (!alive) return;
        const ids = step === "loopback" ? ["speaker", "mic"].filter(wants) : [step];
        setRunning(ids);
        const cap = <V,>(p: Promise<V>, fallback: V) => within(p, STEP_TIMEOUT_MS[step] ?? 15_000, fallback);
        try {
          switch (step) {
            case "battery": record("battery", await cap(batteryStep(), timedOut(step))); break;
            case "sensors": record("sensors", await cap(sensorsStep(), timedOut(step))); break;
            case "motion": record("motion", await cap(motionStep(), timedOut(step))); break;
            case "connectivity": record("connectivity", await cap(connectivityStep(), timedOut(step))); break;
            case "vibration": record("vibration", await cap(vibrationStep(), timedOut(step))); break;
            case "loopback": {
              const r = await cap(speakerMicStep(recorder), { mic: timedOut(step), speaker: timedOut(step), speakerOnDb: null });
              micWorks = r.mic.outcome === "pass";
              if (r.speakerOnDb != null) speakerOnDb = r.speakerOnDb;
              if (wants("mic")) record("mic", r.mic);
              if (wants("speaker")) record("speaker", r.speaker);
              break;
            }
            case "voice": record("voice", await cap(voiceStep(recorder, micWorks, speakerOnDb), timedOut(step))); break;
            case "flash": record("flash", await cap(flashStep(rigProxy), timedOut(step))); break;
            case "camera": record("camera", await cap(cameraStep(rigProxy, (l) => alive && setLine(l)), timedOut(step))); break;
            case "faceid": record("faceid", await cap(faceidStep(), timedOut(step))); break;
            case "bluetooth":
            case "nfc": record(step, await cap(featureStep(step), timedOut(step))); break;
          }
        } catch (e) {
          // A bug or a native exception is not evidence about the phone.
          const reason = `the check stopped unexpectedly: ${String((e as Error)?.message ?? e).slice(0, 160)}`;
          for (const id of ids) record(id, { outcome: "skip", detail: { method: "error", reason } });
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
            <Row key={id} name={names[id] ?? id} state={outcomeOf(id)} last={i === all.length - 1} />
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

function Row({ name, state, last }: { name: string; state: Outcome | "running" | "waiting"; last: boolean }) {
  const [mark, color, bg, word] =
    state === "pass" ? ["✓", P.pass, P.passBg, "Working"]
    : state === "fail" ? ["✗", P.fail, P.failBg, "Problem found"]
    : state === "skip" ? ["–", P.warn, P.warnBg, "Not tested"]
    : state === "unsupported" ? ["–", P.muted, P.surface2, "Not on this phone"]
    : state === "running" ? ["", P.primary, "transparent", "Checking…"]
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
  word: { fontSize: 14, fontWeight: "600" },
});
