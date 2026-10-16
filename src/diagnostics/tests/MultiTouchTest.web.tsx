// Browser version of "three fingers down". On the web React Native's
// nativeEvent.touches is a DOM TouchList (no locationX/Y, no .map), so this
// listens to the DOM TouchEvent directly: `touches.length` is exactly the
// number of fingers on the glass, same meaning as the native test. Screens that
// report fewer than NEED touch points (desktops, mouse-only) can't run it.
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { T } from "../../shared/theme";
import { asHtml, webStyle } from "../web/browser";
import { CantBody } from "../web/WebParts";

const NEED = 3; // fingers held simultaneously

function touchPoints(): number {
  return typeof navigator !== "undefined" ? navigator.maxTouchPoints ?? 0 : 0;
}

export function MultiTouchTest(p: TestProps) {
  const padRef = useRef<View>(null);
  const [pts, setPts] = useState<{ x: number; y: number; id: string }[]>([]);
  const [max, setMax] = useState(0);
  const maxRef = useRef(0);
  const holdSince = useRef<number | null>(null);
  const done = useRef(false);
  const hasTouch = typeof window !== "undefined" && ("ontouchstart" in window || touchPoints() > 0);
  const canMulti = hasTouch && (touchPoints() === 0 || touchPoints() >= NEED); // 0 = browser doesn't say; let them try

  useEffect(() => {
    const el = asHtml(padRef.current);
    if (!el || !canMulti) return;
    const update = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault(); // no scroll / zoom / long-press menu
      const r = el.getBoundingClientRect();
      const list: { x: number; y: number; id: string }[] = [];
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        list.push({ x: t.clientX - r.left, y: t.clientY - r.top, id: String(t.identifier) });
      }
      setPts(list);
      maxRef.current = Math.max(maxRef.current, list.length);
      setMax(maxRef.current);
      if (list.length >= NEED) {
        if (holdSince.current == null) holdSince.current = Date.now();
        else if (Date.now() - holdSince.current > 700 && !done.current) {
          done.current = true;
          p.onResult("pass", { maxSimultaneous: maxRef.current, required: NEED, input: "touch" });
        }
      } else holdSince.current = null;
    };
    // A still hand sends no touchmove — re-check the hold on a timer too.
    const tick = setInterval(() => {
      if (done.current || holdSince.current == null) return;
      if (Date.now() - holdSince.current > 700) {
        done.current = true;
        p.onResult("pass", { maxSimultaneous: maxRef.current, required: NEED, input: "touch" });
      }
    }, 100);
    const opts: AddEventListenerOptions = { passive: false };
    el.addEventListener("touchstart", update, opts);
    el.addEventListener("touchmove", update, opts);
    el.addEventListener("touchend", update, opts);
    el.addEventListener("touchcancel", update, opts);
    return () => {
      clearInterval(tick);
      el.removeEventListener("touchstart", update);
      el.removeEventListener("touchmove", update);
      el.removeEventListener("touchend", update);
      el.removeEventListener("touchcancel", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canMulti]);
  useEffect(() => () => { done.current = true; }, []);

  if (!canMulti) {
    const reason = hasTouch
      ? `This browser reports only ${touchPoints()} touch point${touchPoints() === 1 ? "" : "s"}.`
      : "This browser has no touch screen to test.";
    return (
      <TestShell {...p} instructions={reason} autoVerdict="unsupported" hideManual detail={{ reason, runtime: "browser", maxTouchPoints: touchPoints() }}>
        <CantBody emoji={p.test.emoji} />
      </TestShell>
    );
  }

  return (
    <TestShell {...p} instructions={`Place ${NEED} fingers on the pad at the same time and hold for a second.`} detail={{ maxSimultaneous: max, required: NEED, input: "touch", maxTouchPoints: touchPoints() }}>
      <View ref={padRef} style={[s.pad, webStyle({ touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" })]}>
        <Text style={s.count}>{pts.length}</Text>
        <Text style={s.sub}>fingers now · best {max}</Text>
        {pts.map((pt) => (
          <View key={pt.id} style={[s.dot, { left: pt.x - 34, top: pt.y - 34 }]} />
        ))}
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({
  pad: { flex: 1, backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  count: { color: T.text, fontSize: 96, fontWeight: "900", pointerEvents: "none" },
  sub: { color: T.muted, pointerEvents: "none" },
  dot: { position: "absolute", width: 68, height: 68, borderRadius: 34, backgroundColor: T.accent + "aa", borderWidth: 2, borderColor: "#fff", pointerEvents: "none" },
});
