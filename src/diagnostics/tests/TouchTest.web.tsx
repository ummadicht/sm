// Browser version of the touchscreen grid. React Native's touch responder
// gives no locationX/Y on the web, so this listens to Pointer Events on the
// grid's DOM node (finger, pen or mouse) with touch-action:none so a drag never
// scrolls the page. Coalesced samples are used so a fast swipe clears every
// square it really crossed — but nothing is interpolated: a dead strip on the
// digitiser must still show up as squares that will not clear.
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { T } from "../../shared/theme";
import { asHtml, webStyle } from "../web/browser";

const COLS = 6, ROWS = 10;

export function TouchTest(p: TestProps) {
  const gridRef = useRef<View>(null);
  const [cleared, setCleared] = useState<boolean[]>(() => Array(COLS * ROWS).fill(false));
  const [inputs, setInputs] = useState<string[]>([]);
  const doneRef = useRef(false);
  const remaining = cleared.filter((c) => !c).length;
  const input = inputs.length ? inputs.join("+") : null;

  useEffect(() => {
    const el = asHtml(gridRef.current);
    if (!el) return;
    const active = new Set<number>();
    const kinds = new Set<string>();

    const hit = (pts: { x: number; y: number }[]) => {
      if (doneRef.current) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      setCleared((prev) => {
        let next = prev;
        for (const pt of pts) {
          const c = Math.floor(((pt.x - r.left) / r.width) * COLS);
          const row = Math.floor(((pt.y - r.top) / r.height) * ROWS);
          if (c < 0 || c >= COLS || row < 0 || row >= ROWS) continue;
          const i = row * COLS + c;
          if (!next[i]) {
            if (next === prev) next = [...prev];
            next[i] = true;
          }
        }
        if (next !== prev && next.every(Boolean) && !doneRef.current) {
          doneRef.current = true;
          setTimeout(() => p.onResult("pass", { cells: COLS * ROWS, cleared: COLS * ROWS, input: [...kinds].join("+") || null }), 350);
        }
        return next;
      });
    };
    const samples = (e: PointerEvent) => {
      const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      return (list.length ? list : [e]).map((x) => ({ x: x.clientX, y: x.clientY }));
    };
    const down = (e: PointerEvent) => {
      active.add(e.pointerId);
      const k = e.pointerType || "unknown";
      if (!kinds.has(k)) {
        kinds.add(k);
        setInputs([...kinds]);
      }
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable — moves still arrive while over the grid */
      }
      e.preventDefault();
      hit(samples(e));
    };
    const move = (e: PointerEvent) => {
      if (!active.has(e.pointerId)) return;
      e.preventDefault();
      hit(samples(e));
    };
    const up = (e: PointerEvent) => {
      active.delete(e.pointerId);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TestShell {...p} instructions="Drag your finger over the whole screen until every square is cleared." detail={{ cells: COLS * ROWS, cleared: COLS * ROWS - remaining, input }} bleed>
      <View style={{ flex: 1 }}>
        <View style={s.hint}>
          <Text style={s.hintText}>{remaining === 0 ? "All clear ✓" : `${remaining} ${remaining === 1 ? "square" : "squares"} left`}</Text>
        </View>
        <View ref={gridRef} style={[s.grid, webStyle({ touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", cursor: "crosshair" })]}>
          {cleared.map((c, i) => (
            <View key={i} style={[s.cell, { width: `${100 / COLS}%`, height: `${100 / ROWS}%`, backgroundColor: c ? "transparent" : T.accent }]} />
          ))}
        </View>
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap", backgroundColor: T.bg },
  cell: { borderWidth: 1, borderColor: T.bg, pointerEvents: "none" },
  hint: { pointerEvents: "none", position: "absolute", top: 8, alignSelf: "center", zIndex: 2, backgroundColor: "#000a", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  hintText: { color: "#fff", fontWeight: "700" },
});
