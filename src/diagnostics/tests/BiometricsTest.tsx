import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as LA from "expo-local-authentication";
import { TestProps, TestShell } from "../TestShell";
import { Btn, Row } from "../../shared/ui";
import { Result } from "../catalog";

const typeName = (t: LA.AuthenticationType) =>
  t === LA.AuthenticationType.FACIAL_RECOGNITION ? "Face" : t === LA.AuthenticationType.FINGERPRINT ? "Fingerprint" : t === LA.AuthenticationType.IRIS ? "Iris" : "Other";

// Hardware present + enrolled → a real authenticate() round-trip decides.
// Hardware present but nothing enrolled → cannot be exercised; tester decides.
// No hardware → not applicable (skip), never a fail.
export function BiometricsTest(p: TestProps) {
  const [hw, setHw] = useState<boolean | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [auto, setAuto] = useState<Result | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const h = await LA.hasHardwareAsync();
      setHw(h);
      if (!h) { setAuto("skip"); return; }
      setTypes((await LA.supportedAuthenticationTypesAsync()).map(typeName));
      setEnrolled(await LA.isEnrolledAsync());
    })().catch(() => setAuto("skip"));
  }, []);

  const run = async () => {
    const r = await LA.authenticateAsync({ promptMessage: "GradeIQ sensor test", cancelLabel: "Cancel", disableDeviceFallback: true });
    if (r.success) { setAuto("pass"); setMsg("Sensor authenticated."); }
    else { setMsg(`Not authenticated: ${r.error ?? "unknown"}`); if (r.error === "lockout" || r.error === "authentication_failed") setAuto("fail"); }
  };

  const detail = { hardware: hw, types: types.join(", ") || null, enrolled };
  return (
    <TestShell {...p} instructions={hw === false ? "No biometric hardware reported — not applicable." : enrolled ? "Tap Authenticate and use the enrolled face/finger." : enrolled === false ? "Hardware present but nothing enrolled, so it can't be exercised here. Pass if the sensor area is intact, or skip."
      : "Probing…"} autoVerdict={auto} detail={detail}>
      <View style={s.wrap}>
        <Row label="Hardware" value={hw == null ? "…" : hw ? "present" : "none"} tone={hw ? "pass" : hw === false ? "skip" : undefined} />
        <Row label="Types" value={types.join(", ") || "—"} />
        <Row label="Enrolled" value={enrolled == null ? "…" : enrolled ? "yes" : "no"} />
        {hw && enrolled ? <Btn title="Authenticate" onPress={run} style={{ marginTop: 16 }} /> : null}
        {!!msg && <Text style={{ color: "#9b97aa", marginTop: 8 }}>{msg}</Text>}
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center" } });
