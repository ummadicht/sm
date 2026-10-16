// "Testing your phone…" — one progress bar and a list that ticks itself.
// Runs the automatic steps in order (./plan AUTO_ORDER), hands every verdict to
// onResult (the Check engine's outbox: disk first, then the store), and never
// asks the customer anything. The only line it may show is a physical action
// ("Hold the phone up") when a camera saw nothing.
// Native only.
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { RecordingPresets, useAudioRecorder } from "expo-audio";
import { T } from "../../shared/theme";
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
        <Text style={s.kicker}>SwapUp Check</Text>
        <Text style={s.title}>Testing your phone…</Text>
        <Text style={s.sub}>Leave it on the counter — the checks run by themselves.</Text>
        <View style={s.bar}>
          <View style={[s.fill, { width: `${Math.round(pct * 100)}%` }]} />
        </View>
        <View style={s.barRow}>
          <Text style={s.count}>
            {done} of {all.length}
          </Text>
          {status}
        </View>
      </View>
      {line ? (
        <View style={s.action}>
          <Text style={s.actionText}>{line}</Text>
        </View>
      ) : null}
      <View style={s.camRow}>{rig.view}</View>
      <ScrollView contentContainerStyle={s.list}>
        {all.map((id) => (
          <Row key={id} name={names[id] ?? id} state={outcomeOf(id)} />
        ))}
      </ScrollView>
    </View>
  );
}

function Row({ name, state }: { name: string; state: Outcome | "running" | "waiting" }) {
  const [mark, color, word] =
    state === "pass" ? ["✓", T.pass, "Working"]
    : state === "fail" ? ["✗", T.fail, "Problem found"]
    : state === "skip" ? ["–", T.warn, "Not tested"]
    : state === "unsupported" ? ["–", T.skip, "Not on this phone"]
    : state === "running" ? ["", T.accent, "Checking…"]
    : ["", T.muted, ""];
  return (
    <View style={s.row}>
      <View style={s.mark}>{state === "running" ? <ActivityIndicator size="small" color={T.accent} /> : <Text style={[s.markText, { color }]}>{mark}</Text>}</View>
      <Text style={[s.name, state === "waiting" && { color: T.muted }]}>{name}</Text>
      <Text style={[s.word, { color }]}>{word}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  head: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 12 },
  kicker: { color: T.accent, fontSize: 14, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 },
  title: { color: T.text, fontSize: 30, fontWeight: "800", lineHeight: 36 },
  sub: { color: T.muted, fontSize: 17, lineHeight: 24, marginTop: 6 },
  bar: { height: 12, borderRadius: 6, backgroundColor: T.surface2, overflow: "hidden", marginTop: 18 },
  fill: { height: "100%", backgroundColor: T.accent },
  barRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8 },
  count: { color: T.text, fontSize: 15, fontWeight: "800" },
  action: { marginHorizontal: 22, marginBottom: 8, padding: 14, borderRadius: T.radius, borderWidth: 2, borderColor: T.warn, backgroundColor: T.surface },
  actionText: { color: T.text, fontSize: 19, fontWeight: "800", lineHeight: 26, textAlign: "center" },
  camRow: { alignItems: "center" },
  list: { paddingHorizontal: 22, paddingBottom: 30 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border },
  mark: { width: 26, alignItems: "center" },
  markText: { fontSize: 20, fontWeight: "900" },
  name: { flex: 1, color: T.text, fontSize: 17, fontWeight: "600" },
  word: { fontSize: 15, fontWeight: "700" },
});
