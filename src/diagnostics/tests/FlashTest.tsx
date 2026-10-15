import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { TestProps, TestShell } from "../TestShell";
import { Btn } from "../../shared/ui";

// Torch needs an active rear-camera session; a 1pt preview keeps it alive.
export function FlashTest(p: TestProps) {
  const [perm, request] = useCameraPermissions();
  const [on, setOn] = useState(false);
  if (!perm?.granted) {
    return (
      <TestShell {...p} instructions="Camera permission is needed to drive the torch." autoVerdict="skip">
        <View style={{ flex: 1, justifyContent: "center" }}><Btn title="Allow camera" onPress={() => request()} /></View>
      </TestShell>
    );
  }
  return (
    <TestShell {...p} instructions="Toggle the torch. The rear LED should light instantly, steady and bright. Flicker or no light is a FAIL." detail={{ toggled: on }}>
      <View style={s.wrap}>
        <CameraView style={{ width: 1, height: 1, opacity: 0 }} facing="back" enableTorch={on} />
        <Text style={s.big}>{on ? "🔦" : "⚫"}</Text>
        <Btn title={on ? "Turn torch OFF" : "Turn torch ON"} onPress={() => setOn(!on)} />
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center", gap: 20 }, big: { fontSize: 80, textAlign: "center" } });
