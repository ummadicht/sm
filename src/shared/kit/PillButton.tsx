// Buttons are pills (samsung.com): primary = filled blue, white bold label on the
// LEFT and an arrow on the RIGHT (Pandas); outline = 1.5 px ink border on a
// transparent background. Busy swaps the arrow for a spinner and the label
// says what is happening ("Connecting…") — the label teaches, the shape doesn't.
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import { P } from "../theme";

export type PillKind = "primary" | "outline";

export function Arrow({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 12h15M13 5.5 19.5 12 13 18.5" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function PillButton({
  title,
  onPress,
  kind = "primary",
  disabled,
  busy,
  arrow,
  size = "lg",
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  kind?: PillKind;
  disabled?: boolean;
  busy?: boolean;
  /** Default: on for a large button, off for a small one. */
  arrow?: boolean;
  /** lg = the docked 56 px button (label left, arrow right); sm = a 44 px inline pill, label centred. */
  size?: "lg" | "sm";
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const primary = kind === "primary";
  const fg = primary ? P.onPrimary : P.ink;
  const showArrow = arrow ?? size === "lg";
  const off = !!disabled || !!busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: off, busy: !!busy }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        s.base,
        size === "sm" ? s.sm : s.lg,
        primary ? { backgroundColor: pressed ? P.primaryPressed : P.primary } : [s.outline, pressed && { backgroundColor: P.surface2 }],
        { opacity: disabled ? 0.4 : 1 },
        style,
      ]}
    >
      <Text style={[s.label, size === "sm" ? s.labelSm : s.labelLg, { color: fg }, !showArrow && !busy && { textAlign: "center" }]} numberOfLines={2}>
        {title}
      </Text>
      {busy ? (
        <View style={s.icon}>
          <ActivityIndicator color={fg} />
        </View>
      ) : showArrow ? (
        <View style={s.icon}>
          <Arrow color={fg} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** At most one per screen: a small text link under the button. */
export function QuietLink({ title, onPress, disabled, style }: { title: string; onPress: () => void; disabled?: boolean; style?: ViewStyle }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [s.quiet, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }, style]}
    >
      <Text style={s.quietText}>{title}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  base: { flexDirection: "row", alignItems: "center", borderRadius: 999 },
  lg: { minHeight: 56, paddingLeft: 26, paddingRight: 20, paddingVertical: 12, gap: 12 },
  sm: { minHeight: 44, paddingHorizontal: 18, paddingVertical: 8, justifyContent: "center", gap: 8 },
  outline: { borderWidth: 1.5, borderColor: P.ink, backgroundColor: "transparent" },
  label: { fontSize: 18, fontWeight: "700", letterSpacing: 0.1 },
  // lg: the label takes the row, the arrow sits at the far right. sm: sized to its text, centred
  // (no `flex: 0` — on the web that is a 0% basis and the label collapses to its longest word).
  labelLg: { flex: 1 },
  labelSm: { flexShrink: 1, fontSize: 16 },
  icon: { width: 24, alignItems: "center", justifyContent: "center" },
  quiet: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, alignSelf: "center" },
  quietText: { color: P.primary, fontSize: 16, fontWeight: "600", textAlign: "center" },
});
