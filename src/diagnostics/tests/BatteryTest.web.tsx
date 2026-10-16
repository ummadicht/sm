// Browser version of the battery gauge: the Battery Status API
// (navigator.getBattery — Chrome and Samsung Internet on Android). Safari and
// Firefox don't have it → the browser can't test it. Battery HEALTH is not
// exposed to any web page (nor to Android apps) and is left blank, not guessed.
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { Row, P } from "../../shared/ui";
import { Result } from "../catalog";
import { CantBody } from "../web/WebParts";
import { batteryApi } from "../web/browser";

export function BatteryTest(p: TestProps) {
  const [lvl, setLvl] = useState<number | null>(null);
  const [st, setSt] = useState<string>("…");
  const [auto, setAuto] = useState<Result | null>(() => (batteryApi() ? null : "unsupported"));

  useEffect(() => {
    const get = batteryApi();
    if (!get) return;
    let alive = true;
    get()
      .then((b) => {
        if (!alive) return;
        const level = Number.isFinite(b.level) ? Math.round(b.level * 100) : null;
        setLvl(level);
        setSt(b.charging ? (level === 100 ? "full" : "charging") : "unplugged");
        setAuto(level == null ? "unsupported" : "pass");
      })
      .catch(() => alive && setAuto("unsupported"));
    return () => { alive = false; };
  }, []);

  const detail = { levelPct: lvl, state: st, lowPowerMode: null, healthPct: null, method: "battery-status-api", runtime: "browser" };
  if (auto === "unsupported") {
    const reason = "This browser can't read the battery.";
    return (
      <TestShell {...p} instructions={reason} autoVerdict="unsupported" hideManual detail={{ ...detail, reason }}>
        <CantBody emoji={p.test.emoji} />
      </TestShell>
    );
  }
  return (
    <TestShell {...p} instructions="Battery level read from the phone through the browser." autoVerdict={auto} hideManual detail={detail}>
      <View style={s.wrap}>
        <Row label="Level" value={lvl == null ? "…" : `${lvl}%`} tone={lvl == null ? undefined : lvl < 20 ? "warn" : "pass"} />
        <Row label="State" value={st} />
        <Row label="Low power mode" value="not visible to a browser" tone="skip" />
        <Row label="Health (max capacity)" value="not exposed" tone="skip" />
        <P muted style={{ marginTop: 12, fontSize: 13 }}>Battery health is checked by the advisor (Settings → Battery / Phonecheck).</P>
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center" } });
