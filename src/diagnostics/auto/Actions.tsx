// The only two things the customer does on the native app (docs/AUTO-TESTS.md):
// swipe over every square, and plug in the charger. No Pass/Fail/Skip buttons —
// the grid and the battery state decide, and waiting too long is "not tested".
// Native only.
import React, { useEffect, useRef, useState } from "react";
import { GestureResponderEvent, StyleSheet, Text, View } from "react-native";
import * as Battery from "expo-battery";
import { T } from "../../shared/theme";
import type { Detail, Outcome } from "./analysis";
import { batteryStateName } from "../device";
import { COLS, ROWS, applyTouches, cellAt, newTouchState, touchVerdict, type TouchState } from "./touch";
import { isCharging } from "./steps";

type Done = (outcome: Outcome, detail: Detail) => void;

/* ─────────────────────────── touch grid ─────────────────────────── */

export function TouchAction({ onResult, step, steps }: { onResult: Done; step: number; steps: number }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const st = useRef<TouchState>(newTouchState(Date.now()));
  const [cleared, setCleared] = useState<boolean[]>(st.current.cleared);
  const [stuck, setStuck] = useState(false);
  const finished = useRef(false);
  const cb = useRef(onResult);
  cb.current = onResult;

  const finish = (outcome: Outcome, detail: Detail) => {
    if (finished.current) return;
    finished.current = true;
    setTimeout(() => cb.current(outcome, detail), outcome === "pass" ? 350 : 0);
  };

  useEffect(() => {
    const t = setInterval(() => {
      if (finished.current) return;
      const now = Date.now();
      const v = touchVerdict(st.current, now);
      if (v) finish(v.outcome, v.detail);
      else setStuck(now - st.current.lastProgressAt > 12_000);
    }, 500);
    return () => clearInterval(t);
  }, []);

  const mark = (e: GestureResponderEvent) => {
    if (!size.w || finished.current) return;
    const touches = e.nativeEvent.touches.length ? e.nativeEvent.touches : [e.nativeEvent];
    const cells = touches.map((t) => cellAt(t.locationX, t.locationY, size.w, size.h));
    const prev = st.current;
    const next = applyTouches(prev, cells, Date.now());
    st.current = next;
    if (next.cleared !== prev.cleared) setCleared(next.cleared);
    const v = touchVerdict(next, Date.now());
    if (v?.outcome === "pass") finish(v.outcome, v.detail);
  };

  const remaining = cleared.filter((c) => !c).length;
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <View style={a.head}>
        <Text style={a.step}>
          Step {step} of {steps}
        </Text>
        <Text style={a.title}>Swipe over every square</Text>
        <Text style={a.sub}>
          {remaining === 0 ? "All clear ✓" : stuck ? `${remaining} left — swipe over the bright squares. Ones that won't clear are noted for the advisor.` : `${remaining} ${remaining === 1 ? "square" : "squares"} left`}
        </Text>
      </View>
      <View style={a.grid} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} onTouchStart={mark} onTouchMove={mark}>
        {cleared.map((c, i) => (
          <View key={i} pointerEvents="none" style={[a.cell, { width: `${100 / COLS}%`, height: `${100 / ROWS}%`, backgroundColor: c ? "transparent" : T.accent }]} />
        ))}
      </View>
    </View>
  );
}

/* ─────────────────────────── charger ─────────────────────────── */

export const CHARGE_WAIT_MS = 45_000;

export function ChargingAction({ onResult, step, steps }: { onResult: Done; step: number; steps: number }) {
  const [phase, setPhase] = useState<"checking" | "waiting" | "charging">("checking");
  const [left, setLeft] = useState(Math.round(CHARGE_WAIT_MS / 1000));
  const cb = useRef(onResult);
  cb.current = onResult;

  useEffect(() => {
    let alive = true;
    let finished = false;
    const t0 = Date.now();
    const method = "battery state";
    const finish = (o: Outcome, d: Detail, delay = 0) => {
      if (finished || !alive) return;
      finished = true;
      setTimeout(() => alive && cb.current(o, { method, ...d }), delay);
    };
    let sub: { remove: () => void } | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;
    (async () => {
      const now = await isCharging();
      if (!alive) return;
      if (now === null) return finish("skip", { reason: "the battery state can't be read on this phone" });
      if (now) {
        setPhase("charging");
        return finish("pass", { detectedVia: "already-charging", afterSec: 0 }, 600);
      }
      setPhase("waiting");
      const seen = (how: string) => {
        setPhase("charging");
        finish("pass", { detectedVia: how, afterSec: Math.round((Date.now() - t0) / 1000) }, 800);
      };
      sub = Battery.addBatteryStateListener(({ batteryState }) => {
        const n = batteryStateName(batteryState);
        if (n === "charging" || n === "full") seen("cable-detected");
      });
      // The listener can miss a change on some phones; poll as well.
      tick = setInterval(async () => {
        const ms = Date.now() - t0;
        setLeft(Math.max(0, Math.ceil((CHARGE_WAIT_MS - ms) / 1000)));
        if (ms >= CHARGE_WAIT_MS) return finish("skip", { reason: "no charger was plugged in within 45 s", waitedSec: Math.round(ms / 1000) });
        if (await isCharging()) seen("state-poll");
      }, 1000);
    })();
    return () => {
      alive = false;
      sub?.remove();
      if (tick) clearInterval(tick);
    };
  }, []);

  return (
    <View style={a.center}>
      <Text style={a.step}>
        Step {step} of {steps}
      </Text>
      <Text style={a.bigEmoji}>{phase === "charging" ? "⚡" : "🔌"}</Text>
      <Text style={[a.title, { textAlign: "center" }]}>{phase === "charging" ? "Charging ✓" : "Plug in the charger"}</Text>
      {phase === "waiting" ? (
        <>
          <Text style={[a.sub, { textAlign: "center" }]}>Use the store's cable. This moves on by itself in {left} s.</Text>
          <View style={[a.bar, { marginTop: 22 }]}>
            <View style={[a.fill, { width: `${Math.round((left / (CHARGE_WAIT_MS / 1000)) * 100)}%` }]} />
          </View>
        </>
      ) : null}
    </View>
  );
}

const a = StyleSheet.create({
  head: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 },
  step: { color: T.muted, fontSize: 14, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  title: { color: T.text, fontSize: 28, fontWeight: "800", lineHeight: 34, marginTop: 4 },
  sub: { color: T.muted, fontSize: 17, lineHeight: 24, marginTop: 6 },
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap", backgroundColor: T.bg },
  cell: { borderWidth: 1, borderColor: T.bg },
  center: { flex: 1, backgroundColor: T.bg, padding: 24, justifyContent: "center", alignItems: "stretch" },
  bigEmoji: { fontSize: 88, textAlign: "center", marginVertical: 12 },
  bar: { height: 10, borderRadius: 5, backgroundColor: T.surface2, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: T.warn },
});
