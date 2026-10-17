// The few pieces between the headline and the button: a white card, a notice,
// a text field, a list option, a reading row, a progress bar, a status line.
// No borders on the screen itself; white on grey does the separating.
import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import { P } from "../theme";

export type Tone = "pass" | "warn" | "fail";

export const toneColor = (tone?: Tone | "muted" | null): string =>
  tone === "pass" ? P.pass : tone === "warn" ? P.warn : tone === "fail" ? P.fail : tone === "muted" ? P.muted : P.ink;

/** White, radius 26 (One UI). */
export function Card({ children, style, pad = true }: { children: React.ReactNode; style?: ViewStyle; pad?: boolean }) {
  return <View style={[s.card, pad && { padding: 20 }, style]}>{children}</View>;
}

/** A short message in a pale box: info (white), warn (amber), fail (red), pass (green). */
export function Notice({ tone, children, style }: { tone?: Tone; children: React.ReactNode; style?: ViewStyle }) {
  const bg = tone === "pass" ? P.passBg : tone === "warn" ? P.warnBg : tone === "fail" ? P.failBg : P.surface;
  const fg = tone === "warn" ? "#8A4B00" : tone === "fail" ? "#A52219" : tone === "pass" ? "#1F6E40" : P.ink;
  return (
    <View style={[s.notice, { backgroundColor: bg }, style]} accessibilityRole={tone === "fail" || tone === "warn" ? "alert" : undefined}>
      <Text style={[s.noticeText, { color: fg }]}>{children}</Text>
    </View>
  );
}

/** A white text field. `big` = the centred, letter-spaced entry of a code or an IMEI. */
export function Field({ big, style, ...rest }: TextInputProps & { big?: "code" | "digits"; style?: TextStyle }) {
  return <TextInput placeholderTextColor={P.faint} selectionColor={P.primary} {...rest} style={[s.field, big === "code" && s.code, big === "digits" && s.digits, style]} />;
}

function Check({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12.5 10 17.5 19 7" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** One choice in a list (brand, model, storage). */
export function Option({ title, selected, onPress }: { title: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [s.option, selected && s.optionOn, pressed && { backgroundColor: P.surface2 }]}
    >
      <Text style={s.optionText}>{title}</Text>
      {selected ? <Check color={P.primary} /> : null}
    </Pressable>
  );
}

/** A small rounded chip that goes back a step ("Samsung ✎"). */
export function Chip({ title, onPress, accessibilityLabel }: { title: string; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} style={({ pressed }) => [s.chip, pressed && { backgroundColor: P.surface2 }]}>
      <Text style={s.chipText}>{title}</Text>
    </Pressable>
  );
}

/** One reading: label left, value right, hairline under it (inside a Card). */
export function FactRow({ label, value, tone, last }: { label: string; value: string; tone?: Tone | "muted"; last?: boolean }) {
  return (
    <View style={[s.fact, last && { borderBottomWidth: 0 }]}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={[s.factValue, { color: toneColor(tone) }]}>{value}</Text>
    </View>
  );
}

/** A thin rounded bar. */
export function ProgressBar({ value, color = P.primary, style }: { value: number; color?: string; style?: ViewStyle }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={[s.track, style]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
      <View style={[s.bar, { width: `${Math.round(pct * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

/** A coloured dot and a line of status ("Waiting for the advisor's tablet…"). */
export function StatusLine({ text, tone, style }: { text: string; tone?: Tone | "muted" | "live"; style?: ViewStyle }) {
  const dot = tone === "live" ? P.primary : tone === "muted" || !tone ? P.faint : toneColor(tone);
  return (
    <View style={[s.status, style]} accessibilityLiveRegion="polite">
      <View style={[s.dot, { backgroundColor: dot }]} />
      <Text style={s.statusText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: P.surface, borderRadius: P.radius },
  notice: { borderRadius: P.radiusSm, paddingVertical: 14, paddingHorizontal: 16 },
  noticeText: { fontSize: 15, lineHeight: 22 },
  field: {
    backgroundColor: P.surface,
    borderRadius: P.radiusSm,
    borderWidth: 1,
    borderColor: P.line,
    color: P.ink,
    fontSize: 18,
    minHeight: 56,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  code: { fontSize: 30, fontWeight: "800", letterSpacing: 8, textAlign: "center", minHeight: 68 },
  digits: { fontSize: 22, fontWeight: "700", letterSpacing: 2, textAlign: "center" },
  option: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    borderRadius: P.radiusSm,
    borderWidth: 1.5,
    borderColor: "transparent",
    backgroundColor: P.surface,
  },
  optionOn: { borderColor: P.primary },
  optionText: { flex: 1, color: P.ink, fontSize: 17, fontWeight: "600" },
  chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.5, borderColor: P.ink },
  chipText: { color: P.ink, fontSize: 15, fontWeight: "700" },
  fact: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: P.line,
  },
  factLabel: { color: P.muted, fontSize: 16, flexShrink: 0 },
  factValue: { fontSize: 16, fontWeight: "700", textAlign: "right", flexShrink: 1 },
  track: { height: 8, borderRadius: 4, backgroundColor: P.surface2, overflow: "hidden" },
  bar: { height: "100%", borderRadius: 4 },
  status: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "center", maxWidth: "100%" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { flexShrink: 1, color: P.ink, fontSize: 16, lineHeight: 22, fontWeight: "600" },
});
