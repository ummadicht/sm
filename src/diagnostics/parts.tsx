// Big, plain building blocks for the hardware tests. The person holding the
// phone is a customer at a shop counter, not a technician: large text, large
// touch targets, one clear action at a time. Drawn in the SWAPUP EXPERIENCE
// CENTER look (theme P): pill buttons — filled blue, or a 1.5 px ink outline.
// The docked label-left/arrow-right button of a whole screen is the kit's
// PillButton (src/shared/kit); Big is the centred pill used inside a screen.
import React from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import { P } from "../shared/theme";

export type BigKind = "primary" | "pass" | "fail" | "secondary" | "quiet";

export function Big({
  title,
  onPress,
  kind = "primary",
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: BigKind;
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const bg =
    kind === "primary" ? P.primary
    : kind === "pass" ? P.pass
    : kind === "fail" ? P.fail
    : "transparent";
  const fg = kind === "secondary" ? P.ink : kind === "quiet" ? P.primary : P.onPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.big,
        kind === "quiet" && s.quiet,
        kind === "secondary" && s.outline,
        { backgroundColor: pressed && kind === "primary" ? P.primaryPressed : pressed && kind === "secondary" ? P.surface2 : bg },
        { opacity: disabled ? 0.4 : pressed && kind !== "primary" && kind !== "secondary" ? 0.75 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : null}
      <Text style={[s.bigText, kind === "quiet" && s.quietText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

/** One reading, label on the left, value on the right. */
export function Fact({ label, value, tone }: { label: string; value: string; tone?: "pass" | "fail" | "warn" | "skip" }) {
  const color = tone === "pass" ? P.pass : tone === "fail" ? P.fail : tone === "warn" ? P.warn : tone === "skip" ? P.muted : P.ink;
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={[s.factValue, { color }]}>{value}</Text>
    </View>
  );
}

export function Say({ children, muted, center, style }: { children: React.ReactNode; muted?: boolean; center?: boolean; style?: object }) {
  return <Text style={[s.say, muted && { color: P.muted }, center && { textAlign: "center" }, style]}>{children}</Text>;
}

export function BigEmoji({ children }: { children: string }) {
  return <Text style={s.emoji}>{children}</Text>;
}

/**
 * Open an Android settings page (Bluetooth, NFC, Wi‑Fi). Falls back to the
 * phone's main Settings, then to this app's own settings page.
 */
export async function openAndroidSettings(action: string): Promise<void> {
  if (Platform.OS === "android") {
    try {
      await Linking.sendIntent(action);
      return;
    } catch {
      try {
        await Linking.sendIntent("android.settings.SETTINGS");
        return;
      } catch {
        /* fall through */
      }
    }
  }
  await Linking.openSettings().catch(() => {});
}

const s = StyleSheet.create({
  big: {
    minHeight: 56,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  outline: { borderWidth: 1.5, borderColor: P.ink },
  bigText: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  quiet: { minHeight: 44, paddingVertical: 8 },
  quietText: { fontSize: 16, fontWeight: "600" },
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
  say: { color: P.ink, fontSize: 17, lineHeight: 25 },
  emoji: { fontSize: 76, textAlign: "center" },
});
