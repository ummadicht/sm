import React, { useRef, useState } from "react";
import { GestureResponderEvent, StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { T } from "../../shared/theme";

const COLS = 6, ROWS = 10;

// Every cell must be touched at least once — a dead strip on the digitiser
// shows up as cells that will not clear no matter how the tester drags.
export function TouchTest(p: TestProps) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cleared, setCleared] = useState<boolean[]>(() => Array(COLS * ROWS).fill(false));
  const doneRef = useRef(false);
  const remaining = cleared.filter((c) => !c).length;

  const mark = (e: GestureResponderEvent) => {
    if (!size.w || doneRef.current) return;
    const touches = e.nativeEvent.touches.length ? e.nativeEvent.touches : [e.nativeEvent];
    setCleared((prev) => {
      let next = prev;
      for (const t of touches) {
        const c = Math.floor((t.locationX / size.w) * COLS);
        const r = Math.floor((t.locationY / size.h) * ROWS);
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
        const i = r * COLS + c;
        if (!next[i]) { if (next === prev) next = [...prev]; next[i] = true; }
      }
      if (next !== prev && next.every(Boolean) && !doneRef.current) {
        doneRef.current = true;
        setTimeout(() => p.onResult("pass", { cells: COLS * ROWS, cleared: COLS * ROWS }), 350);
      }
      return next;
    });
  };

  return (
    <TestShell {...p} instructions="Drag your finger over the whole screen until every square is cleared." detail={{ cells: COLS * ROWS, cleared: COLS * ROWS - remaining }} bleed>
      <View style={{ flex: 1 }}>
        <View style={s.hint}><Text style={s.hintText}>{remaining === 0 ? "All clear ✓" : `${remaining} squares left`}</Text></View>
        <View
          style={s.grid}
          onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          onTouchStart={mark}
          onTouchMove={mark}
        >
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
  cell: { borderWidth: 1, borderColor: T.bg },
  hint: { position: "absolute", top: 8, alignSelf: "center", zIndex: 2, backgroundColor: "#000a", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  hintText: { color: "#fff", fontWeight: "700" },
});
