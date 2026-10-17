// The step rail on every SwapUp Check screen: Identify · Scan · Test · Result —
// GradeIQ v2's StepRail (giq/app/components/V2Flow.tsx), so the customer always
// sees where they are and how much is left. The battery screenshot counts as
// Test: it is a check of the phone's own health.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { T } from "../shared/theme";

export type RailStep = "identify" | "scan" | "test" | "result";

const STEPS: { key: RailStep; label: string }[] = [
  { key: "identify", label: "Identify" },
  { key: "scan", label: "Scan" },
  { key: "test", label: "Test" },
  { key: "result", label: "Result" },
];

export function StepRail({ at }: { at: RailStep }) {
  const active = STEPS.findIndex((s) => s.key === at);
  return (
    <View style={s.row} accessibilityRole="progressbar" accessibilityLabel={`Step ${active + 1} of ${STEPS.length}: ${STEPS[active]?.label}`}>
      {STEPS.map((step, i) => {
        const lit = i <= active;
        return (
          <View key={step.key} style={s.cell}>
            <View style={[s.bar, { backgroundColor: lit ? T.accent : T.border }]} />
            <Text style={[s.label, { color: i === active ? T.accent : T.muted, opacity: lit ? 1 : 0.6 }]}>{step.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** A screen with the rail above it (the rail never sits over a full-screen pattern — the Scan screen draws its own). */
export function Railed({ at, children }: { at: RailStep; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <StepRail at={at} />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 4, backgroundColor: T.bg },
  cell: { flex: 1, alignItems: "center", gap: 6 },
  bar: { height: 4, alignSelf: "stretch", borderRadius: 2 },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
});
