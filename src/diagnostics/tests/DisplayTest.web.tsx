// Browser version of the colour fills. A page can't set the screen brightness,
// so the customer is asked to turn it up — that part is skipped, not failed.
// The fills cover the whole viewport (position:fixed, over the runner's top
// bar) and go true full-screen where the browser allows it (Android Chrome;
// iPhone Safari has no full-screen for pages, so its toolbars stay visible).
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { Big, BigEmoji, Say } from "../parts";
import { webStyle } from "../web/browser";

const FILLS: { name: string; color: string; hint: string }[] = [
  { name: "White", color: "#ffffff", hint: "Look for dark spots, yellow tint, burn-in ghosts" },
  { name: "Black", color: "#000000", hint: "Look for bright/stuck pixels and backlight bleed" },
  { name: "Red", color: "#ff0000", hint: "Even colour edge to edge?" },
  { name: "Green", color: "#00ff00", hint: "Even colour edge to edge?" },
  { name: "Blue", color: "#0000ff", hint: "Even colour edge to edge?" },
  { name: "Grey 50%", color: "#808080", hint: "Banding, lines, pressure marks show here" },
];

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

function enterFullscreen(): void {
  const el = document.documentElement as FsEl;
  try {
    if (typeof el.requestFullscreen === "function") el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    else if (typeof el.webkitRequestFullscreen === "function") el.webkitRequestFullscreen();
  } catch {
    /* refused — the fixed overlay still covers the page */
  }
}

function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

function exitFullscreen() {
  const d = document as FsDoc;
  try {
    if (d.fullscreenElement && typeof d.exitFullscreen === "function") d.exitFullscreen().catch(() => {});
    else if (d.webkitFullscreenElement && typeof d.webkitExitFullscreen === "function") d.webkitExitFullscreen();
  } catch {
    /* already out */
  }
}

export function DisplayTest(p: TestProps) {
  const [phase, setPhase] = useState<"intro" | "fills" | "review">("intro");
  const [i, setI] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    // Record whether the fills really went full-screen (not just whether we asked).
    const on = () => {
      if (isFullscreen()) setFullscreen(true);
    };
    document.addEventListener("fullscreenchange", on);
    document.addEventListener("webkitfullscreenchange", on);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      document.removeEventListener("webkitfullscreenchange", on);
      exitFullscreen();
    };
  }, []);
  useEffect(() => {
    if (phase === "review") exitFullscreen();
  }, [phase]);

  const start = () => {
    // Must run inside the tap: browsers only allow full-screen from a user gesture.
    enterFullscreen();
    setI(0);
    setPhase("fills");
  };
  const detail = { fillsReviewed: phase === "review" ? FILLS.length : i, fullscreen, brightness: "customer-set (a browser can't control it)", runtime: "browser" };

  if (phase === "fills") {
    const fill = FILLS[i];
    return (
      <Pressable
        accessibilityRole="button"
        style={[s.full, webStyle({ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, cursor: "pointer" }), { backgroundColor: fill.color }]}
        onPress={() => (i + 1 < FILLS.length ? setI(i + 1) : setPhase("review"))}
      >
        <View style={s.badge}>
          <Text style={s.badgeTitle}>{fill.name} · {i + 1}/{FILLS.length}</Text>
          <Text style={s.badgeHint}>{fill.hint}. Tap to continue.</Text>
        </View>
      </Pressable>
    );
  }

  if (phase === "intro") {
    return (
      <TestShell {...p} instructions="Six colours will fill the whole screen, one per tap. Look closely at each one." hideManual detail={detail}>
        <View style={s.wrap}>
          <BigEmoji>☀️</BigEmoji>
          <Say center>Turn your screen brightness all the way up first.</Say>
          <Say muted center style={{ fontSize: 15 }}>
            Your browser can't change the brightness for you, so this part is up to you.
          </Say>
          <Big title="Show the colours" onPress={start} />
        </View>
      </TestShell>
    );
  }

  return (
    <TestShell {...p} instructions="You have seen all six fills. Any dead/stuck pixels, lines, burn-in, bleed or discolouration is a FAIL." hideManual detail={detail}>
      <View style={s.wrap}>
        <Say center>Was the screen clean on every colour?</Say>
        <Big title="Yes, it looked clean" kind="pass" onPress={() => p.onResult("pass", detail)} />
        <Big title="No, I saw a problem" kind="fail" onPress={() => p.onResult("fail", detail)} />
        <Big title="Look again" kind="quiet" onPress={start} />
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", gap: 14 },
  full: { flex: 1, justifyContent: "flex-end", padding: 24 },
  badge: { backgroundColor: "#000c", borderRadius: 12, padding: 12, alignSelf: "center" },
  badgeTitle: { color: "#fff", fontWeight: "800", fontSize: 16, textAlign: "center" },
  badgeHint: { color: "#ccc", fontSize: 12, textAlign: "center", marginTop: 2 },
});
