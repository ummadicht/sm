import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import * as Network from "expo-network";
import * as Cellular from "expo-cellular";
import * as Location from "expo-location";
import { TestProps, TestShell } from "../TestShell";
import { Row } from "../../shared/ui";
import { Result } from "../catalog";
import { Detail } from "../../shared/types";

const gen = (g: Cellular.CellularGeneration | null) =>
  g === Cellular.CellularGeneration.CELLULAR_5G ? "5G" : g === Cellular.CellularGeneration.CELLULAR_4G ? "4G" : g === Cellular.CellularGeneration.CELLULAR_3G ? "3G" : g === Cellular.CellularGeneration.CELLULAR_2G ? "2G" : "unknown";

// Three radios in one pass. Network connectivity decides the verdict; SIM and
// GPS are reported as evidence (a desk often tests with no SIM and indoors).
export function ConnectivityTest(p: TestProps) {
  const [d, setD] = useState<Detail>({});
  const [auto, setAuto] = useState<Result | null>(null);
  const [gps, setGps] = useState("locating…");

  useEffect(() => {
    let alive = true;
    (async () => {
      const net = await Network.getNetworkStateAsync().catch(() => null);
      const ip = await Network.getIpAddressAsync().catch(() => null);
      const carrier = await Cellular.getCarrierNameAsync().catch(() => null);
      const g = await Cellular.getCellularGenerationAsync().catch(() => null);
      const iso = await Cellular.getIsoCountryCodeAsync().catch(() => null);
      const base: Detail = {
        networkType: net?.type ?? null, connected: net?.isConnected ?? null, internet: net?.isInternetReachable ?? null, ip,
        carrier, cellular: gen(g), simCountry: iso, simPresent: !!carrier,
      };
      if (!alive) return;
      setD(base);
      setAuto(net?.isConnected ? "pass" : "fail");
      const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (!alive) return;
      if (!perm?.granted) { setGps("permission denied"); setD((x) => ({ ...x, gps: "denied" })); return; }
      const fix = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.LocationAccuracy.High }),
        new Promise<null>((r) => setTimeout(() => r(null), 25000)),
      ]).catch(() => null);
      if (!alive) return;
      if (fix) { const acc = Math.round(fix.coords.accuracy ?? 0); setGps(`fix ±${acc} m`); setD((x) => ({ ...x, gps: "fix", gpsAccuracyM: acc })); }
      else { setGps("no fix in 25 s (indoors?)"); setD((x) => ({ ...x, gps: "no-fix" })); }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <TestShell {...p} instructions="Wi-Fi/cellular must be connected to pass. SIM and GPS are recorded as evidence; no SIM or an indoor no-fix is not a fail by itself." autoVerdict={auto} detail={d}>
      <View style={s.wrap}>
        <Row label="Network" value={`${String(d.networkType ?? "…")}${d.connected ? " · connected" : d.connected === false ? " · offline" : ""}`} tone={d.connected ? "pass" : d.connected === false ? "fail" : undefined} />
        <Row label="Internet reachable" value={d.internet == null ? "…" : d.internet ? "yes" : "no"} />
        <Row label="IP" value={String(d.ip ?? "—")} />
        <Row label="SIM / carrier" value={d.carrier ? `${d.carrier} · ${d.cellular}${d.simCountry ? " · " + String(d.simCountry).toUpperCase() : ""}` : "no SIM"} tone={d.carrier ? "pass" : "skip"} />
        <Row label="GPS" value={gps} tone={gps.startsWith("fix") ? "pass" : gps.startsWith("no fix") || gps.includes("denied") ? "warn" : undefined} />
        {Platform.OS === "ios" && <Row label="Note" value="iOS hides carrier name on iOS 16+" tone="skip" />}
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center" } });
