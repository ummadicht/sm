import React from "react";
import { Pressable, StyleSheet, Text, View, ViewStyle, TextStyle } from "react-native";
import { T } from "./theme";

type BtnProps = {
  title: string;
  onPress: () => void;
  kind?: "primary" | "ghost" | "pass" | "fail" | "skip";
  disabled?: boolean;
  style?: ViewStyle;
  small?: boolean;
};

export function Btn({ title, onPress, kind = "primary", disabled, style, small }: BtnProps) {
  const bg =
    kind === "primary" ? T.accent
    : kind === "pass" ? T.pass
    : kind === "fail" ? T.fail
    : kind === "skip" ? T.surface2
    : "transparent";
  const fg = kind === "ghost" ? T.accent : kind === "skip" ? T.muted : "#fff";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        kind === "ghost" && { borderWidth: 1, borderColor: T.border },
        style,
      ]}
    >
      <Text style={[s.btnText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function H1({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.h1, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.h2, style]}>{children}</Text>;
}
export function P({ children, style, muted }: { children: React.ReactNode; style?: TextStyle; muted?: boolean }) {
  return <Text style={[s.p, muted && { color: T.muted }, style]}>{children}</Text>;
}
export function Mono({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.mono, style]}>{children}</Text>;
}

export function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "pass" | "fail" | "warn" | "skip" }) {
  const color = tone === "pass" ? T.pass : tone === "fail" ? T.fail : tone === "warn" ? T.warn : tone === "skip" ? T.skip : T.text;
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, { color }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

export function Pill({ text, tone }: { text: string; tone: "pass" | "fail" | "warn" | "skip" | "accent" }) {
  const bg = tone === "pass" ? T.pass : tone === "fail" ? T.fail : tone === "warn" ? T.warn : tone === "accent" ? T.accent : T.surface2;
  const fg = tone === "skip" ? T.muted : "#fff";
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      <Text style={[s.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  const gb = n / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(gb >= 100 ? 0 : 1)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`;
}

const s = StyleSheet.create({
  btn: { minHeight: 52, paddingVertical: 14, paddingHorizontal: 24, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  btnSmall: { minHeight: 0, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 999 },
  btnText: { fontSize: 16, fontWeight: "700", letterSpacing: 0.2 },
  card: { backgroundColor: T.surface, borderRadius: T.radius, padding: 16, borderWidth: 1, borderColor: T.border, gap: 8 },
  h1: { color: T.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  h2: { color: T.text, fontSize: 18, fontWeight: "700" },
  p: { color: T.text, fontSize: 15, lineHeight: 22 },
  mono: { color: T.muted, fontSize: 12, fontFamily: "Menlo", lineHeight: 18 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border },
  rowLabel: { color: T.muted, fontSize: 14, flexShrink: 0 },
  rowValue: { color: T.text, fontSize: 14, fontWeight: "600", textAlign: "right", flexShrink: 1 },
  pill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, alignSelf: "flex-start" },
  pillText: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
});
