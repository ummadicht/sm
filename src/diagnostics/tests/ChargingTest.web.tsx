// Browser version of the charging-port test: the Battery Status API's
// chargingchange event. Passes the moment the phone reports charging after the
// cable goes in (or if it is already charging). No Battery API (Safari,
// Firefox) → the browser can't test it.
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { Result } from "../catalog";
import { T } from "../../shared/theme";
import { CantBody } from "../web/WebParts";
import { batteryApi } from "../web/browser";

export function ChargingTest(p: TestProps) {
  const [state, setState] = useState<string>("…");
  const [auto, setAuto] = useState<Result | null>(() => (batteryApi() ? null : "unsupported"));
  const [secs, setSecs] = useState(0);
  const done = useRef(false);
  const t0 = useRef(Date.now());

  useEffect(() => {
    const get = batteryApi();
    if (!get) return;
    let alive = true;
    let cleanup = () => {};
    const finish = (how: string) => {
      if (done.current || !alive) return;
      done.current = true;
      setAuto("pass");
      setTimeout(() => p.onResult("pass", { detectedVia: how, afterSec: Math.round((Date.now() - t0.current) / 1000), method: "battery-status-api", runtime: "browser" }), 600);
    };
    get()
      .then((b) => {
        if (!alive) return;
        const read = () => setState(b.charging ? (b.level >= 1 ? "full" : "charging") : "unplugged");
        read();
        if (b.charging) finish("already-charging");
        const onChange = () => {
          read();
          if (b.charging) finish("cable-detected");
        };
        b.addEventListener("chargingchange", onChange);
        cleanup = () => b.removeEventListener("chargingchange", onChange);
      })
      .catch(() => alive && setAuto("unsupported"));
    const tick = setInterval(() => setSecs(Math.round((Date.now() - t0.current) / 1000)), 1000);
    return () => {
      alive = false;
      cleanup();
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (auto === "unsupported") {
    const reason = "This browser can't tell when a charger is plugged in.";
    return (
      <TestShell {...p} instructions={reason} autoVerdict="unsupported" hideManual detail={{ reason, runtime: "browser" }}>
        <CantBody emoji={p.test.emoji} />
      </TestShell>
    );
  }
  const charging = state === "charging" || state === "full";
  return (
    <TestShell {...p} instructions="Plug a charger into the phone now. Passes by itself when the phone reports charging. Nothing after ~30 s? Wiggle the cable — then press Fail." autoVerdict={auto} detail={{ state, waitedSec: secs, method: "battery-status-api", runtime: "browser" }}>
      <View style={s.wrap}>
        <Text style={s.big}>{charging ? "⚡" : "🔌"}</Text>
        <Text style={s.state}>{charging ? "Charging ✓" : state === "unplugged" ? "Plug the charger in now" : state}</Text>
        <Text style={{ color: T.muted, textAlign: "center", fontSize: 16 }}>{secs}s waiting</Text>
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center", gap: 8 }, big: { fontSize: 80, textAlign: "center" }, state: { color: T.text, fontSize: 24, fontWeight: "800", textAlign: "center" } });
