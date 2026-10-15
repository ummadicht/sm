import React, { useEffect, useRef, useState } from "react";
import { GestureResponderEvent, StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { T } from "../../shared/theme";

const NEED = 3; // fingers held simultaneously

export function MultiTouchTest(p: TestProps) {
  const [pts, setPts] = useState<{ x: number; y: number; id: string }[]>([]);
  const [max, setMax] = useState(0);
  const holdSince = useRef<number | null>(null);
  const done = useRef(false);

  const update = (e: GestureResponderEvent) => {
    const ts = e.nativeEvent.touches;
    setPts(ts.map((t) => ({ x: t.locationX, y: t.locationY, id: String(t.identifier) })));
    setMax((m) => Math.max(m, ts.length));
    if (ts.length >= NEED) {
      if (holdSince.current == null) holdSince.current = Date.now();
      else if (Date.now() - holdSince.current > 700 && !done.current) {
        done.current = true;
        p.onResult("pass", { maxSimultaneous: Math.max(max, ts.length), required: NEED });
      }
    } else holdSince.current = null;
  };
  useEffect(() => () => { done.current = true; }, []);

  return (
    <TestShell {...p} instructions={`Place ${NEED} fingers on the pad at the same time and hold for a second.`} detail={{ maxSimultaneous: max, required: NEED }}>
      <View style={s.pad} onTouchStart={update} onTouchMove={update} onTouchEnd={update} onTouchCancel={update}>
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
  count: { color: T.text, fontSize: 96, fontWeight: "900" },
  sub: { color: T.muted },
  dot: { position: "absolute", width: 68, height: 68, borderRadius: 34, backgroundColor: T.accent + "aa", borderWidth: 2, borderColor: "#fff" },
});
