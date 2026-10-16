// Big, plain building blocks for the hardware tests. The person holding the
// phone is a customer at a shop counter, not a technician: large text, large
// touch targets, one clear action at a time.
import React from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import { T } from "../shared/theme";

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
    kind === "primary" ? T.accent
    : kind === "pass" ? T.pass
    : kind === "fail" ? T.fail
    : kind === "secondary" ? T.surface2
    : "transparent";
  const fg = kind === "secondary" ? T.text : kind === "quiet" ? T.muted : "#08111f";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.big,
        kind === "quiet" && s.quiet,
        kind === "secondary" && { borderWidth: 1, borderColor: T.border },
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
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
  const color = tone === "pass" ? T.pass : tone === "fail" ? T.fail : tone === "warn" ? T.warn : tone === "skip" ? T.muted : T.text;
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={[s.factValue, { color }]}>{value}</Text>
    </View>
  );
}

export function Say({ children, muted, center, style }: { children: React.ReactNode; muted?: boolean; center?: boolean; style?: object }) {
  return <Text style={[s.say, muted && { color: T.muted }, center && { textAlign: "center" }, style]}>{children}</Text>;
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
    minHeight: 58,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: T.radius,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  bigText: { fontSize: 19, fontWeight: "800", textAlign: "center" },
  quiet: { minHeight: 48, paddingVertical: 10 },
  quietText: { fontSize: 17, fontWeight: "700", textDecorationLine: "underline" },
  fact: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
  },
  factLabel: { color: T.muted, fontSize: 17, flexShrink: 0 },
  factValue: { fontSize: 18, fontWeight: "700", textAlign: "right", flexShrink: 1 },
  say: { color: T.text, fontSize: 18, lineHeight: 26 },
  emoji: { fontSize: 76, textAlign: "center" },
});
