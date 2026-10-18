// Browser version of the radios check. What a page can really test: that the
// phone is online and can reach the SwapUp server right now, the network type
// where Chrome on Android tells us (wifi / cellular), and a GPS fix (with
// permission). What it can't: whether a SIM / mobile signal is present — that
// is reported as "not visible to a browser", never assumed.
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { Row } from "../../shared/ui";
import { Result } from "../catalog";
import { Detail } from "../../shared/types";
import { connectionApi } from "../web/browser";

async function reachServer(): Promise<boolean> {
  if (typeof fetch !== "function") return false;
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const t = setTimeout(() => ctrl?.abort(), 8000);
  try {
    // Same origin as the app itself, so no CORS; no-store so a cached copy can't fake it.
    const r = await fetch(window.location.href, { method: "HEAD", cache: "no-store", signal: ctrl?.signal });
    return r.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** effectiveType is a speed class ("4g" = fast on any network, Wi‑Fi included), not the radio in use. */
function speedWord(t: string): string {
  return t === "4g" ? "fast" : t === "3g" ? "medium" : t === "2g" || t === "slow-2g" ? "slow" : t;
}

export function ConnectivityTest(p: TestProps) {
  const [d, setD] = useState<Detail>({ cellular: "not visible to a browser", simPresent: null, runtime: "browser" });
  const [auto, setAuto] = useState<Result | null>(null);
  const [gps, setGps] = useState("locating…");

  useEffect(() => {
    let alive = true;
    const c = connectionApi();
    const base: Detail = {
      online: typeof navigator !== "undefined" ? navigator.onLine : null,
      networkType: c?.type ?? "not reported",
      effectiveType: c?.effectiveType ?? null,
      downlinkMbps: typeof c?.downlink === "number" ? c.downlink : null,
      rttMs: typeof c?.rtt === "number" ? c.rtt : null,
    };
    setD((x) => ({ ...x, ...base }));
    reachServer().then((ok) => {
      if (!alive) return;
      setD((x) => ({ ...x, connected: ok, internet: ok }));
      setAuto(ok ? "pass" : "fail");
    });

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGps("not available in this browser");
      setD((x) => ({ ...x, gps: "unavailable" }));
    } else {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!alive) return;
          const acc = Math.round(pos.coords.accuracy ?? 0);
          setGps(`fix ±${acc} m`);
          setD((x) => ({ ...x, gps: "fix", gpsAccuracyM: acc }));
        },
        (err) => {
          if (!alive) return;
          if (err.code === err.PERMISSION_DENIED) {
            setGps("permission denied");
            setD((x) => ({ ...x, gps: "denied" }));
          } else {
            setGps(err.code === err.TIMEOUT ? "no fix in 25 s (indoors?)" : "no fix (location off?)");
            setD((x) => ({ ...x, gps: "no-fix" }));
          }
        },
        { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 }
      );
    }
    return () => {
      alive = false;
    };
  }, []);

  const type = String(d.networkType ?? "…");
  return (
    <TestShell {...p} instructions="Passes when the phone is online." autoVerdict={auto} detail={d}>
      <View style={s.wrap}>
        <Row
          label="Online"
          value={d.connected == null ? "checking…" : d.connected ? "reached the store's server" : "can't reach the server"}
          tone={d.connected ? "pass" : d.connected === false ? "fail" : undefined}
        />
        <Row label="Network type" value={type === "wifi" ? "Wi‑Fi" : type} />
        <Row label="Connection speed" value={d.effectiveType ? `${speedWord(String(d.effectiveType))}${d.downlinkMbps != null ? ` · ~${d.downlinkMbps} Mbps` : ""}` : "not reported"} />
        <Row label="SIM / mobile signal" value="not visible to a browser" tone="skip" />
        <Row label="GPS" value={gps} tone={gps.startsWith("fix") ? "pass" : gps.startsWith("no fix") || gps.includes("denied") ? "warn" : undefined} />
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center" } });
