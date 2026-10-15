import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Barometer, Gyroscope, LightSensor, Magnetometer } from "expo-sensors";
import { TestProps, TestShell } from "../TestShell";
import { Row } from "../../shared/ui";
import { Result } from "../catalog";

// Roll-call of the "other" sensors. Compass must exist AND change as the phone
// turns; light sensor (Android only) must react when covered; barometer and
// gyroscope are availability checks.
export function SensorsTest(p: TestProps) {
  const [mag, setMag] = useState<{ avail: boolean | null; heading: number | null; span: number }>({ avail: null, heading: null, span: 0 });
  const [light, setLight] = useState<{ avail: boolean | null; lux: number | null; min: number; max: number }>({ avail: null, lux: null, min: Infinity, max: -Infinity });
  const [baro, setBaro] = useState<{ avail: boolean | null; hPa: number | null }>({ avail: null, hPa: null });
  const [gyro, setGyro] = useState<boolean | null>(null);
  const minH = useRef(Infinity), maxH = useRef(-Infinity);

  useEffect(() => {
    const subs: { remove: () => void }[] = [];
    Gyroscope.isAvailableAsync().then(setGyro).catch(() => setGyro(false));
    Magnetometer.isAvailableAsync().then((a) => {
      setMag((m) => ({ ...m, avail: a }));
      if (!a) return;
      Magnetometer.setUpdateInterval(150);
      subs.push(Magnetometer.addListener(({ x, y }) => {
        let h = Math.atan2(y, x) * (180 / Math.PI); if (h < 0) h += 360;
        minH.current = Math.min(minH.current, h); maxH.current = Math.max(maxH.current, h);
        setMag((m) => ({ ...m, heading: Math.round(h), span: Math.round(maxH.current - minH.current) }));
      }));
    }).catch(() => setMag((m) => ({ ...m, avail: false })));
    Barometer.isAvailableAsync().then((a) => {
      setBaro((b) => ({ ...b, avail: a }));
      if (!a) return;
      subs.push(Barometer.addListener(({ pressure }) => setBaro((b) => ({ ...b, hPa: Math.round(pressure) }))));
    }).catch(() => setBaro((b) => ({ ...b, avail: false })));
    if (Platform.OS === "android") {
      LightSensor.isAvailableAsync().then((a) => {
        setLight((l) => ({ ...l, avail: a }));
        if (!a) return;
        LightSensor.setUpdateInterval(200);
        subs.push(LightSensor.addListener(({ illuminance }) => setLight((l) => ({ ...l, lux: Math.round(illuminance), min: Math.min(l.min, illuminance), max: Math.max(l.max, illuminance) }))));
      }).catch(() => setLight((l) => ({ ...l, avail: false })));
    } else setLight((l) => ({ ...l, avail: false }));
    return () => subs.forEach((s) => s.remove());
  }, []);

  const compassOk = mag.avail && mag.span >= 40;
  const lightOk = light.avail ? light.max - light.min > 20 : null;
  const auto: Result | null = mag.avail === false ? "fail" : compassOk ? "pass" : null;
  const detail = { magnetometer: mag.avail, compassSpanDeg: mag.span, lightSensor: light.avail, luxMin: isFinite(light.min) ? Math.round(light.min) : null, luxMax: isFinite(light.max) ? Math.round(light.max) : null, barometer: baro.avail, pressureHPa: baro.hPa, gyroscope: gyro };

  return (
    <TestShell {...p} instructions="Turn the phone a half-circle for the compass. On Android, cover the top of the screen with your palm for the light sensor." autoVerdict={auto} detail={detail}>
      <View style={s.wrap}>
        <Row label="Compass" value={mag.avail == null ? "…" : !mag.avail ? "not available" : `${mag.heading ?? "…"}° · swept ${mag.span}° (need 40°)`} tone={compassOk ? "pass" : mag.avail === false ? "fail" : undefined} />
        <Row label="Light sensor" value={Platform.OS === "ios" ? "not exposed on iOS" : light.avail == null ? "…" : !light.avail ? "not available" : `${light.lux ?? "…"} lx · range ${isFinite(light.min) ? Math.round(light.max - light.min) : 0} lx`} tone={lightOk ? "pass" : light.avail === false ? "skip" : undefined} />
        <Row label="Barometer" value={baro.avail == null ? "…" : !baro.avail ? "not available" : `${baro.hPa ?? "…"} hPa`} tone={baro.avail ? "pass" : baro.avail === false ? "skip" : undefined} />
        <Row label="Gyroscope" value={gyro == null ? "…" : gyro ? "available" : "not available"} tone={gyro ? "pass" : gyro === false ? "warn" : undefined} />
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center" } });
