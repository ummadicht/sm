// The only two things the customer does on the native app (docs/AUTO-TESTS.md):
// swipe over every square, and plug in the charger. No Pass/Fail/Skip buttons —
// the grid and the battery state decide, and waiting too long is "not tested".
// Native only. Look: the kit (theme P) — blue squares on the grey tint; the
// charger step is a battery illustration and one headline.
import React, { useEffect, useRef, useState } from "react";
import { GestureResponderEvent, StyleSheet, View } from "react-native";
import * as Battery from "expo-battery";
import { P } from "../../shared/theme";
import { BatteryArt, Eyebrow, Headline, Lead, ProgressBar } from "../../shared/kit";
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
    <View style={{ flex: 1, backgroundColor: P.bg }}>
      <View style={a.head}>
        <Eyebrow>
          Step {step} of {steps}
        </Eyebrow>
        <Headline size="md">Swipe over every square</Headline>
        <Lead style={{ marginTop: 6 }}>
          {remaining === 0 ? "All clear ✓" : stuck ? `${remaining} left — swipe over the blue squares. Ones that won't clear are noted for the advisor.` : `${remaining} ${remaining === 1 ? "square" : "squares"} left`}
        </Lead>
      </View>
      <View style={a.grid} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} onTouchStart={mark} onTouchMove={mark}>
        {cleared.map((c, i) => (
          <View key={i} pointerEvents="none" style={[a.cell, { width: `${100 / COLS}%`, height: `${100 / ROWS}%`, backgroundColor: c ? "transparent" : P.primary }]} />
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
      <Eyebrow style={{ textAlign: "center" }}>
        Step {step} of {steps}
      </Eyebrow>
      <View style={a.art}>
        <BatteryArt width={180} level={phase === "charging" ? 0.75 : 0.3} charging={phase === "charging"} />
      </View>
      <Headline center>{phase === "charging" ? "Charging ✓" : "Plug in the charger"}</Headline>
      {phase === "waiting" ? (
        <>
          <Lead center>Use the store&apos;s cable. This moves on by itself in {left} s.</Lead>
          <ProgressBar value={left / (CHARGE_WAIT_MS / 1000)} style={{ marginTop: 26 }} />
        </>
      ) : null}
    </View>
  );
}

const a = StyleSheet.create({
  head: { paddingHorizontal: P.gutter, paddingTop: 22, paddingBottom: 14 },
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap", backgroundColor: P.bg },
  cell: { borderWidth: 1, borderColor: P.bg, borderRadius: 4 },
  center: { flex: 1, backgroundColor: P.bg, padding: P.gutter, justifyContent: "center", alignItems: "stretch" },
  art: { alignItems: "center", marginTop: 18, marginBottom: 30 },
});
