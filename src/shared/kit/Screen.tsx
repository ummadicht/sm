// The screen: grey-tint background, 24 px sides, content from the top (headline
// in One UI's viewing area), a Hero that takes the space that is left, and the
// pill button docked at the bottom in `footer`. Safe areas are the app's
// (CheckApp's SafeAreaView); the keyboard pushes the footer up.
import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import { P } from "../theme";

export function Screen({
  children,
  footer,
  topRight,
  scroll = true,
  contentStyle,
}: {
  children: React.ReactNode;
  /** Docked under the content: the PillButton, then at most one QuietLink / Caption. */
  footer?: React.ReactNode;
  /** A small control in the top-right corner (the "?" HelpButton). */
  topRight?: React.ReactNode;
  /** false = a fixed layout (no scrolling), e.g. a screen that fills itself. */
  scroll?: boolean;
  contentStyle?: ViewStyle;
}) {
  return (
    // "padding" on Android too: the app is edge-to-edge, so the window no longer shrinks for the
    // keyboard; the padding is only the real overlap, so a resizing window gets none.
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "web" ? undefined : "padding"}>
      {scroll ? (
        <ScrollView style={s.fill} contentContainerStyle={[s.content, contentStyle]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[s.fill, s.content, contentStyle]}>{children}</View>
      )}
      {footer ? <View style={s.footer}>{footer}</View> : null}
      {topRight ? <View style={s.topRight}>{topRight}</View> : null}
    </KeyboardAvoidingView>
  );
}

/** The one visual, centred in the space between the text and the button. */
export function Hero({ children, minHeight = 160, grow = true, style }: { children: React.ReactNode; minHeight?: number; grow?: boolean; style?: ViewStyle }) {
  return <View style={[s.hero, grow && { flexGrow: 1 }, { minHeight }, style]}>{children}</View>;
}

/** Vertical space. */
export function Gap({ h = 16 }: { h?: number }) {
  return <View style={{ height: h }} />;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.bg },
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: P.gutter, paddingTop: 28, paddingBottom: 20 },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, gap: 10, backgroundColor: P.bg },
  topRight: { position: "absolute", top: 14, right: 16 },
  hero: { alignItems: "center", justifyContent: "center", paddingVertical: 20 },
});
