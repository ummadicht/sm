import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Battery from "expo-battery";
import { TestProps, TestShell } from "../TestShell";
import { batteryStateName } from "../device";
import { Result } from "../catalog";
import { T } from "../../shared/theme";

// Pass the moment the OS reports CHARGING or FULL after a cable goes in.
export function ChargingTest(p: TestProps) {
  const [state, setState] = useState<string>("…");
  const [auto, setAuto] = useState<Result | null>(null);
  const [secs, setSecs] = useState(0);
  const done = useRef(false);
  const t0 = useRef(Date.now());

  useEffect(() => {
    const finish = (how: string) => {
      if (done.current) return;
      done.current = true;
      setAuto("pass");
      setTimeout(() => p.onResult("pass", { detectedVia: how, afterSec: Math.round((Date.now() - t0.current) / 1000) }), 600);
    };
    Battery.getBatteryStateAsync().then((s) => {
      const n = batteryStateName(s); setState(n);
      if (n === "charging" || n === "full") finish("already-charging");
    }).catch(() => {});
    const sub = Battery.addBatteryStateListener(({ batteryState }) => {
      const n = batteryStateName(batteryState); setState(n);
      if (n === "charging" || n === "full") finish("cable-detected");
    });
    const tick = setInterval(() => setSecs(Math.round((Date.now() - t0.current) / 1000)), 1000);
    return () => { sub.remove(); clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TestShell {...p} instructions="Plug a known-good charger into the port. Passes automatically when the phone reports charging. If nothing after ~30 s, wiggle the cable — then Fail." autoVerdict={auto} detail={{ state, waitedSec: secs }}>
      <View style={s.wrap}>
        <Text style={s.big}>{state === "charging" || state === "full" ? "⚡" : "🔌"}</Text>
        <Text style={s.state}>{state}</Text>
        <Text style={{ color: T.muted, textAlign: "center" }}>{secs}s waiting</Text>
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center", gap: 8 }, big: { fontSize: 80, textAlign: "center" }, state: { color: T.text, fontSize: 22, fontWeight: "800", textAlign: "center", textTransform: "capitalize" } });
