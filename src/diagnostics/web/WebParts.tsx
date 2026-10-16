// Shared pieces for the browser versions of the hardware tests (imported only
// by *.web.tsx files). Same big-button customer style as ../parts.tsx.
import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { BigEmoji, Say } from "../parts";
import { Detail } from "../../shared/types";
import { T } from "../../shared/theme";
import { CANT_LINE } from "./browser";

/** The body every web test shows when the browser can't run it. */
export function CantBody({ emoji, reason }: { emoji: string; reason?: string }) {
  return (
    <View style={s.cant}>
      <BigEmoji>{emoji}</BigEmoji>
      <Text style={s.cantTitle}>Can't test this in a browser</Text>
      <Say muted center>
        {CANT_LINE}
      </Say>
      {reason ? <Text style={s.reason}>{reason}</Text> : null}
    </View>
  );
}

/**
 * A whole test that a browser cannot run. The bar shows one Continue button
 * that records "unsupported" (untested — never a pass).
 */
export function CantTest({ p, reason, detail }: { p: TestProps; reason: string; detail?: Detail }) {
  return (
    <TestShell {...p} instructions={reason} autoVerdict="unsupported" hideManual detail={{ reason, runtime: "browser", ...(detail ?? {}) }}>
      <CantBody emoji={p.test.emoji} reason={reason} />
    </TestShell>
  );
}

/** Live camera preview. Fills its parent (give the parent a size). */
export function LiveVideo({ stream, mirror, hidden }: { stream: MediaStream | null; mirror?: boolean; hidden?: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) v.play().catch(() => {});
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      muted
      playsInline
      style={
        hidden
          ? { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }
          : { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000", transform: mirror ? "scaleX(-1)" : undefined }
      }
    />
  );
}

/** Grab the current video frame as a JPEG data URL + whether it is (nearly) all black. */
export function captureFrame(v: HTMLVideoElement): { url: string; dark: boolean } | null {
  const w = v.videoWidth;
  const h = v.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, 960 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(v, 0, 0, c.width, c.height);
  let dark = false;
  try {
    const t = document.createElement("canvas");
    t.width = 24;
    t.height = 24;
    const tc = t.getContext("2d");
    if (tc) {
      tc.drawImage(c, 0, 0, 24, 24);
      const px = tc.getImageData(0, 0, 24, 24).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      dark = sum / (px.length / 4) < 6;
    }
  } catch {
    /* tainted canvas can't happen for a local stream; ignore */
  }
  return { url: c.toDataURL("image/jpeg", 0.7), dark };
}

const s = StyleSheet.create({
  cant: { flex: 1, justifyContent: "center", gap: 14 },
  cantTitle: { color: T.text, fontSize: 24, fontWeight: "800", textAlign: "center" },
  reason: { color: T.muted, fontSize: 15, lineHeight: 21, textAlign: "center" },
});
