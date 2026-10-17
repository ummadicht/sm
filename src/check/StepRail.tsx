// The step rail on every SwapUp Check screen: Identify · Scan · Test · Result —
// GradeIQ v2's StepRail (giq/app/components/V2Flow.tsx), so the customer always
// sees where they are and how much is left. The battery screenshot counts as
// Test: it is a check of the phone's own health. Drawn quietly (thin bars, small
// labels) so the headline stays the first thing on the screen.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { P } from "../shared/theme";

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
            <View style={[s.bar, { backgroundColor: lit ? P.primary : P.line }]} />
            <Text style={[s.label, { color: i === active ? P.ink : lit ? P.muted : P.faint }]}>{step.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** A screen with the rail above it (the rail never sits over a full-screen pattern — the Scan screen draws its own). */
export function Railed({ at, children }: { at: RailStep; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: P.bg }}>
      <StepRail at={at} />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, paddingHorizontal: P.gutter, paddingTop: 12, paddingBottom: 0, backgroundColor: P.bg },
  cell: { flex: 1, alignItems: "flex-start", gap: 6 },
  bar: { height: 3, alignSelf: "stretch", borderRadius: 2 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
});
