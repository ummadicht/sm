import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Brightness from "expo-brightness";
import { TestProps, TestShell } from "../TestShell";

const FILLS: { name: string; color: string; hint: string }[] = [
  { name: "White", color: "#ffffff", hint: "Look for dark spots, yellow tint, burn-in ghosts" },
  { name: "Black", color: "#000000", hint: "Look for bright/stuck pixels and backlight bleed" },
  { name: "Red", color: "#ff0000", hint: "Even colour edge to edge?" },
  { name: "Green", color: "#00ff00", hint: "Even colour edge to edge?" },
  { name: "Blue", color: "#0000ff", hint: "Even colour edge to edge?" },
  { name: "Grey 50%", color: "#808080", hint: "Banding, lines, pressure marks show here" },
];

// Screen is pushed to full app brightness for the duration, then restored.
export function DisplayTest(p: TestProps) {
  const [i, setI] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    let prev: number | null = null;
    Brightness.getBrightnessAsync().then((b) => { prev = b; return Brightness.setBrightnessAsync(1); }).catch(() => {});
    return () => { if (prev != null) Brightness.setBrightnessAsync(prev).catch(() => {}); };
  }, []);
  const fill = FILLS[i];

  if (!reviewed) {
    return (
      <View style={{ flex: 1 }}>
        <Pressable
          style={[s.full, { backgroundColor: fill.color }]}
          onPress={() => (i + 1 < FILLS.length ? setI(i + 1) : setReviewed(true))}
        >
          <View style={s.badge}>
            <Text style={s.badgeTitle}>{fill.name} · {i + 1}/{FILLS.length}</Text>
            <Text style={s.badgeHint}>{fill.hint}. Tap to continue.</Text>
          </View>
        </Pressable>
      </View>
    );
  }
  return (
    <TestShell {...p} instructions="You have seen all six fills. Any dead/stuck pixels, lines, burn-in, bleed or discolouration is a FAIL." detail={{ fillsReviewed: FILLS.length }}>
      <View style={{ flex: 1, justifyContent: "center", gap: 8 }}>
        <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", textAlign: "center" }}>Was the panel clean on every fill?</Text>
        <Pressable onPress={() => { setI(0); setReviewed(false); }}><Text style={{ color: "#9b4dff", textAlign: "center", fontWeight: "700" }}>Look again</Text></Pressable>
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({
  full: { flex: 1, justifyContent: "flex-end", padding: 24 },
  badge: { backgroundColor: "#000c", borderRadius: 12, padding: 12, alignSelf: "center" },
  badgeTitle: { color: "#fff", fontWeight: "800", fontSize: 16, textAlign: "center" },
  badgeHint: { color: "#ccc", fontSize: 12, textAlign: "center", marginTop: 2 },
});
