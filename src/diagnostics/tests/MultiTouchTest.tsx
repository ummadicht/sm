import React, { useEffect, useRef, useState } from "react";
import { GestureResponderEvent, StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { T } from "../../shared/theme";

const NEED = 3; // fingers held simultaneously

export function MultiTouchTest(p: TestProps) {
  const [pts, setPts] = useState<{ x: number; y: number; id: string }[]>([]);
  const [max, setMax] = useState(0);
  const maxRef = useRef(0);
  const holdSince = useRef<number | null>(null);
  const done = useRef(false);

  const update = (e: GestureResponderEvent) => {
    const ts = e.nativeEvent.touches;
    setPts(ts.map((t) => ({ x: t.locationX, y: t.locationY, id: String(t.identifier) })));
    maxRef.current = Math.max(maxRef.current, ts.length);
    setMax(maxRef.current);
    if (ts.length >= NEED) {
      if (holdSince.current == null) holdSince.current = Date.now();
      else if (Date.now() - holdSince.current > 700 && !done.current) {
        done.current = true;
        p.onResult("pass", { maxSimultaneous: maxRef.current, required: NEED });
      }
    } else holdSince.current = null;
  };
  useEffect(() => {
    // A still hand sends no touchmove — re-check the hold on a timer too.
    const tick = setInterval(() => {
      if (done.current || holdSince.current == null) return;
      if (Date.now() - holdSince.current > 700) {
        done.current = true;
        p.onResult("pass", { maxSimultaneous: maxRef.current, required: NEED });
      }
    }, 100);
    return () => {
      clearInterval(tick);
      done.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TestShell {...p} instructions={`Place ${NEED} fingers on the pad at the same time and hold for a second.`} detail={{ maxSimultaneous: max, required: NEED }}>
      <View style={s.pad} onTouchStart={update} onTouchMove={update} onTouchEnd={update} onTouchCancel={update}>
        <Text pointerEvents="none" style={s.count}>{pts.length}</Text>
        <Text pointerEvents="none" style={s.sub}>fingers now · best {max}</Text>
        {pts.map((pt) => (
          <View key={pt.id} pointerEvents="none" style={[s.dot, { left: pt.x - 34, top: pt.y - 34 }]} />
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
