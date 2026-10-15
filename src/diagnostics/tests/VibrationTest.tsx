import React, { useState } from "react";
import { StyleSheet, Text, View, Vibration } from "react-native";
import * as Haptics from "expo-haptics";
import { TestProps, TestShell } from "../TestShell";
import { Btn } from "../../shared/ui";

export function VibrationTest(p: TestProps) {
  const [n, setN] = useState(0);
  const buzz = async () => {
    setN((x) => x + 1);
    Vibration.vibrate([0, 400, 150, 400]);
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); } catch { /* no haptics engine */ }
  };
  return (
    <TestShell {...p} instructions="Hold the phone loosely and tap Buzz. Two strong pulses should be felt. Weak, rattling or absent vibration is a FAIL." detail={{ triggered: n }}>
      <View style={s.wrap}>
        <Text style={s.big}>📳</Text>
        <Btn title="Buzz" onPress={buzz} />
        <Text style={{ color: "#9b97aa", textAlign: "center" }}>Also fires a heavy haptic (Taptic Engine / Android haptics).</Text>
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center", gap: 20 }, big: { fontSize: 80, textAlign: "center" } });
