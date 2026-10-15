import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as Battery from "expo-battery";
import { TestProps, TestShell } from "../TestShell";
import { Row, P } from "../../shared/ui";
import { batteryStateName } from "../device";
import { Result } from "../catalog";

// Level + state + low-power mode are readable. Battery HEALTH (max capacity %)
// is NOT exposed to third-party apps on iOS or Android — the report says so
// explicitly rather than inventing a number.
export function BatteryTest(p: TestProps) {
  const [lvl, setLvl] = useState<number | null>(null);
  const [st, setSt] = useState<string>("…");
  const [lpm, setLpm] = useState<boolean | null>(null);
  const [auto, setAuto] = useState<Result | null>(null);
  useEffect(() => {
    (async () => {
      const ok = await Battery.isAvailableAsync();
      if (!ok) { setAuto("skip"); return; }
      const ps = await Battery.getPowerStateAsync();
      setLvl(ps.batteryLevel >= 0 ? Math.round(ps.batteryLevel * 100) : null);
      setSt(batteryStateName(ps.batteryState));
      setLpm(ps.lowPowerMode ?? null);
      setAuto(ps.batteryLevel >= 0 ? "pass" : "fail");
    })().catch(() => setAuto("skip"));
  }, []);
  return (
    <TestShell {...p} instructions="Battery gauge read from the OS. A phone that cannot report its level has a battery/gauge fault." autoVerdict={auto} hideManual detail={{ levelPct: lvl, state: st, lowPowerMode: lpm, healthPct: null }}>
      <View style={s.wrap}>
        <Row label="Level" value={lvl == null ? "unknown" : `${lvl}%`} tone={lvl == null ? "fail" : lvl < 20 ? "warn" : "pass"} />
        <Row label="State" value={st} />
        <Row label="Low power mode" value={lpm == null ? "—" : lpm ? "on" : "off"} />
        <Row label="Health (max capacity)" value="not exposed by OS" tone="skip" />
        <P muted style={{ marginTop: 12, fontSize: 13 }}>Health % still comes from Phonecheck / Settings → Battery on the desk; the web GradeIQ passport carries it when available.</P>
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center" } });
