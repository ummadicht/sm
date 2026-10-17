// A white bottom sheet (rounded top, grab handle, a title, one sentence, a small
// picture, the same pill button) — Pandas' sub-step, One UI's radius.
// Tap outside, the handle, or Android back to close.
import React, { useEffect, useRef, useState } from "react";
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { P } from "../theme";
import { useHeadlineFace } from "./fonts";
import { PillButton } from "./PillButton";

const NATIVE = Platform.OS !== "web";

export function Sheet({
  visible,
  onClose,
  title,
  lead,
  art,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  lead?: React.ReactNode;
  /** A small illustration under the sentence. */
  art?: React.ReactNode;
  /** Anything longer (steps, buttons) — scrolls when it doesn't fit. */
  children?: React.ReactNode;
  /** The sheet's pill button(s), docked under the content. */
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const face = useHeadlineFace("800");
  // Stay mounted through the closing slide.
  const [mounted, setMounted] = useState(visible);
  const shown = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);
  // Slide only once the sheet is on screen (a native-driven value needs its view attached first).
  useEffect(() => {
    if (!mounted) return;
    const anim = Animated.timing(shown, { toValue: visible ? 1 : 0, duration: visible ? 260 : 200, useNativeDriver: NATIVE });
    anim.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => anim.stop();
  }, [visible, mounted, shown]);

  if (!mounted) return null;
  const translateY = shown.interpolate({ inputRange: [0, 1], outputRange: [Math.min(600, height), 0] });
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, { opacity: shown }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View style={[s.sheet, { maxHeight: height * 0.88, paddingBottom: Math.max(insets.bottom, 12) + 8, transform: [{ translateY }] }]}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={s.handleHit}>
            <View style={s.handle} />
          </Pressable>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={[s.title, face]}>
              {title}
            </Text>
            {lead ? <Text style={s.lead}>{lead}</Text> : null}
            {art ? <View style={s.art}>{art}</View> : null}
            {children}
          </ScrollView>
          {footer ? <View style={s.footer}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** The round "?" that opens a sheet of the secondary explanations a screen leaves out. */
export function HelpButton({ title, lead, art, children, label = "More about this step" }: { title: string; lead?: React.ReactNode; art?: React.ReactNode; children?: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={({ pressed }) => [s.help, pressed && { backgroundColor: P.surface2 }]}>
        <Text style={s.helpText}>?</Text>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={title} lead={lead} art={art} footer={<PillButton title="Got it" onPress={() => setOpen(false)} />}>
        {children}
      </Sheet>
    </>
  );
}

const s = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.38)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: P.surface,
    borderTopLeftRadius: P.radius,
    borderTopRightRadius: P.radius,
  },
  handleHit: { alignItems: "center", paddingTop: 10, paddingBottom: 6 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: "#D1D1D6" },
  content: { paddingHorizontal: P.gutter, paddingTop: 12, paddingBottom: 8 },
  title: { color: P.ink, fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  lead: { color: P.muted, fontSize: 16, lineHeight: 23, marginTop: 8 },
  art: { alignItems: "center", marginTop: 18, marginBottom: 6 },
  footer: { paddingHorizontal: 20, paddingTop: 10, gap: 4 },
  help: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: P.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  helpText: { color: P.ink, fontSize: 18, fontWeight: "700" },
});
