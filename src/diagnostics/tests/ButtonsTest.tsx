import React, { useEffect, useState } from "react";
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { T } from "../../shared/theme";

const BUTTONS = Platform.OS === "ios"
  ? ["Volume up", "Volume down", "Side / power", "Mute switch or Action"]
  : ["Volume up", "Volume down", "Power", "Back (gesture or key)"];

// Expo Go cannot intercept volume/power keys; the tester ticks each button as
// it responds. Android's back key IS observable and ticks itself.
export function ButtonsTest(p: TestProps) {
  const [ok, setOk] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { setOk((o) => ({ ...o, "Back (gesture or key)": true })); return true; });
    return () => sub.remove();
  }, []);
  const all = BUTTONS.every((b) => ok[b]);
  return (
    <TestShell {...p} instructions="Press each physical button; tick it when the phone responds (volume HUD, screen lock, mute toggle). All ticked = Pass." detail={{ confirmed: BUTTONS.filter((b) => ok[b]).join(", ") || null, total: BUTTONS.length }} autoVerdict={all ? "pass" : null}>
      <View style={{ flex: 1, justifyContent: "center", gap: 10 }}>
        {BUTTONS.map((b) => (
          <Pressable key={b} onPress={() => setOk((o) => ({ ...o, [b]: !o[b] }))} style={[s.item, ok[b] && { borderColor: T.pass }]}>
            <Text style={[s.box, ok[b] && { color: T.pass }]}>{ok[b] ? "☑" : "☐"}</Text>
            <Text style={s.label}>{b}</Text>
          </Pressable>
        ))}
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({
  item: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface },
  box: { color: T.muted, fontSize: 22 },
  label: { color: T.text, fontSize: 16, fontWeight: "600" },
});
