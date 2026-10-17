// Type: one big headline, one muted sentence, small captions, and the wordmark.
import React from "react";
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { BRAND, P } from "../theme";
import { useHeadlineFace } from "./fonts";

/** "SWAPUP EXPERIENCE CENTER" — letter-spaced caps in the brand blue, the store's name under it. No logo. */
export function Wordmark({ store, align = "center", style }: { store?: string | null; align?: "center" | "left"; style?: ViewStyle }) {
  const face = useHeadlineFace("800");
  return (
    <View style={[s.wordmark, align === "left" && { alignItems: "flex-start" }, style]} accessibilityRole="header">
      <Text style={[s.mark, face]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {BRAND.wordmark}
      </Text>
      {store ? (
        <Text style={[s.store, align === "left" && { textAlign: "left" }]} numberOfLines={2}>
          {store}
        </Text>
      ) : null}
    </View>
  );
}

/** The screen's one headline: large, heavy, left-aligned (One UI's viewing area). */
export function Headline({ children, center, size = "lg", style }: { children: React.ReactNode; center?: boolean; size?: "lg" | "md"; style?: TextStyle }) {
  const face = useHeadlineFace("800");
  return (
    <Text accessibilityRole="header" style={[s.headline, size === "md" && s.headlineMd, face, center && { textAlign: "center" }, style]}>
      {children}
    </Text>
  );
}

/** The one sentence under the headline. */
export function Lead({ children, center, style }: { children: React.ReactNode; center?: boolean; style?: TextStyle }) {
  return <Text style={[s.lead, center && { textAlign: "center" }, style]}>{children}</Text>;
}

/** Small muted text: a reference, a reassurance, a hint under a button. */
export function Caption({ children, center = true, tone, style }: { children: React.ReactNode; center?: boolean; tone?: "pass" | "warn" | "fail"; style?: TextStyle }) {
  const color = tone === "pass" ? P.pass : tone === "warn" ? P.warn : tone === "fail" ? P.fail : P.muted;
  return <Text style={[s.caption, { color }, center && { textAlign: "center" }, style]}>{children}</Text>;
}

/** A field's label. */
export function Label({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.label, style]}>{children}</Text>;
}

/** A small uppercase step counter ("Step 1 of 2"). */
export function Eyebrow({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.eyebrow, style]}>{children}</Text>;
}

const s = StyleSheet.create({
  wordmark: { alignItems: "center", gap: 4, marginBottom: 28 },
  mark: { color: P.brand, fontSize: 13, letterSpacing: 2.2, textAlign: "center" },
  store: { color: P.muted, fontSize: 14, lineHeight: 19, textAlign: "center" },
  headline: { color: P.ink, fontSize: 32, lineHeight: 38, letterSpacing: -0.5 },
  headlineMd: { fontSize: 26, lineHeight: 32, letterSpacing: -0.3 },
  lead: { color: P.muted, fontSize: 17, lineHeight: 25, marginTop: 10 },
  caption: { fontSize: 14, lineHeight: 20, marginTop: 10 },
  label: { color: P.ink, fontSize: 15, fontWeight: "600", marginBottom: 8 },
  eyebrow: { color: P.muted, fontSize: 13, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
});
