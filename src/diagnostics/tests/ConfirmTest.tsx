import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { Btn } from "../../shared/ui";
import { T } from "../../shared/theme";

const COPY: Record<string, { emoji: string; steps: string }> = {
  bluetooth: { emoji: "🟦", steps: "Open Settings → Bluetooth. It must switch on and list at least one nearby device within ~10 s. Pair to a desk speaker/earbud if you want proof of audio over BT." },
  nfc: { emoji: "💳", steps: "Hold a contactless card or NFC tag to the back of the phone (top third on most models). The OS should chime / show a tag prompt. iPhone: Wallet double-click shows the reader; Android: Settings → Connected devices → NFC." },
};

// Expo Go ships no Bluetooth or NFC module, so these are tester-confirmed
// with explicit steps. A dev build can swap in react-native-ble-plx /
// react-native-nfc-manager without changing the catalog.
export function ConfirmTest(p: TestProps) {
  const c = COPY[p.test.id] ?? { emoji: p.test.emoji, steps: "Verify and confirm." };
  return (
    <TestShell {...p} instructions={c.steps} detail={{ method: "tester-confirmed" }}>
      <View style={s.wrap}>
        <Text style={s.big}>{c.emoji}</Text>
        <Btn title="Open Settings" kind="ghost" onPress={() => Linking.openSettings().catch(() => {})} />
        <Text style={{ color: T.muted, textAlign: "center", fontSize: 13 }}>Come back to this app afterwards and press Pass or Fail.</Text>
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center", gap: 16 }, big: { fontSize: 80, textAlign: "center" } });
