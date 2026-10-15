import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { TestProps, TestShell } from "../TestShell";
import { T } from "../../shared/theme";

const CANDLES = 5;
const BLOW_DB = -18; // metering is dBFS (−160…0); a close blow peaks well above this

export function MicTest(p: TestProps) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 100);
  const [lit, setLit] = useState(CANDLES);
  const [perm, setPerm] = useState<"asking" | "granted" | "denied">("asking");
  const [peak, setPeak] = useState(-160);
  const lastOut = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await requestRecordingPermissionsAsync();
      if (!alive) return;
      if (!r.granted) { setPerm("denied"); return; }
      setPerm("granted");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    })().catch(() => setPerm("denied"));
    return () => {
      alive = false;
      recorder.stop().catch(() => {});
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = state.metering;
    if (m == null || done.current) return;
    setPeak((pk) => Math.max(pk, m));
    if (m > BLOW_DB && Date.now() - lastOut.current > 350) {
      lastOut.current = Date.now();
      setLit((n) => {
        const next = Math.max(0, n - 1);
        if (next === 0 && !done.current) {
          done.current = true;
          setTimeout(() => p.onResult("pass", { peakDb: Math.round(Math.max(peak, m)), threshold: BLOW_DB }), 400);
        }
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.metering]);

  const level = state.metering == null ? 0 : Math.max(0, Math.min(1, (state.metering + 60) / 60));
  return (
    <TestShell {...p} instructions="Blow (or speak loudly) into the bottom microphone until all five candles go out." autoVerdict={perm === "denied" ? "skip" : null} detail={{ permission: perm, peakDb: Math.round(peak), recording: state.isRecording }}>
      <View style={s.wrap}>
        <View style={s.candles}>
          {Array.from({ length: CANDLES }).map((_, i) => (
            <Text key={i} style={s.candle}>{i < lit ? "🕯️" : "💨"}</Text>
          ))}
        </View>
        <View style={s.meter}><View style={[s.meterFill, { width: `${level * 100}%` }]} /></View>
        <Text style={s.meta}>{perm === "denied" ? "Microphone permission denied — allow it in Settings or skip." : state.isRecording ? `${state.metering?.toFixed(0) ?? "…"} dB · peak ${peak > -160 ? peak.toFixed(0) : "…"} dB` : "Starting microphone…"}</Text>
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", gap: 24 },
  candles: { flexDirection: "row", justifyContent: "center", gap: 6 },
  candle: { fontSize: 44 },
  meter: { height: 14, borderRadius: 7, backgroundColor: T.surface2, overflow: "hidden" },
  meterFill: { height: "100%", backgroundColor: T.pass },
  meta: { color: T.muted, textAlign: "center" },
});
