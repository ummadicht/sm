import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { TestProps, TestShell } from "../TestShell";
import { Btn } from "../../shared/ui";
import { T } from "../../shared/theme";

// Routes a 300 Hz → 3 kHz sweep through the call receiver, not the loudspeaker.
// iOS: with allowsRecording the PlayAndRecord category defaults to the receiver.
// Android: shouldRouteThroughEarpiece does it explicitly.
export function EarpieceTest(p: TestProps) {
  const player = useAudioPlayer(require("../../assets/tones/sweep.wav"));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true, ...(Platform.OS === "android" ? { shouldRouteThroughEarpiece: true } : {}) })
      .then(() => setReady(true)).catch(() => setReady(true));
    return () => { setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, ...(Platform.OS === "android" ? { shouldRouteThroughEarpiece: false } : {}) }).catch(() => {}); };
  }, []);
  return (
    <TestShell {...p} instructions="Hold the phone to your ear like a call and play the sweep. You should hear a rising tone from the small earpiece speaker at the top, clearly and without crackle.">
      <View style={s.wrap}>
        <Text style={s.big}>📞</Text>
        <Btn title="Play sweep in earpiece" onPress={() => { player.seekTo(0).catch(() => {}); player.volume = 1; player.play(); }} disabled={!ready} />
        <Text style={{ color: T.muted, textAlign: "center" }}>If it comes out of the bottom loudspeaker instead, your OS forced the route — still judge the earpiece during a real call.</Text>
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center", gap: 16 }, big: { fontSize: 72, textAlign: "center" } });
