// Browser version of the sensor roll-call. A page can reach the compass
// (Chrome: deviceorientationabsolute; iPhone Safari: webkitCompassHeading,
// after a tap) and see whether the gyroscope reports (devicemotion
// rotationRate). The light sensor and barometer have no web API. The test
// passes only if what could be tested worked (compass turned ≥ 40°); with no
// compass data at all the browser can't test it → "unsupported".
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { Row } from "../../shared/ui";
import { Result } from "../catalog";
import { Big, Say } from "../parts";
import { CantBody } from "../web/WebParts";
import { MOTION_DENIED, motionNeedsTap, OrientationEventLike, requestMotionAccess } from "../web/browser";

const WAIT_MS = 3000;
const NEED_DEG = 40;

type Phase = "tap" | "listening" | "denied";

export function SensorsTest(p: TestProps) {
  const [phase, setPhase] = useState<Phase>(() => (motionNeedsTap() ? "tap" : "listening"));
  const [heading, setHeading] = useState<number | null>(null);
  const [span, setSpan] = useState(0);
  const [compass, setCompass] = useState<boolean | null>(null); // null = still waiting
  const [gyro, setGyro] = useState<boolean | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const unwrapped = useRef<number | null>(null);
  const prev = useRef<number | null>(null);
  const lo = useRef(Infinity), hi = useRef(-Infinity);

  useEffect(() => {
    if (phase !== "listening") return;
    let gotHeading = false;
    let gotGyro = false;
    const take = (h: number, from: string) => {
      gotHeading = true;
      setCompass(true);
      setSource(from);
      // Unwrap across north so a 350° → 10° turn counts as 20°, not 340°.
      if (prev.current == null || unwrapped.current == null) unwrapped.current = h;
      else {
        let d = h - prev.current;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        unwrapped.current += d;
      }
      prev.current = h;
      lo.current = Math.min(lo.current, unwrapped.current);
      hi.current = Math.max(hi.current, unwrapped.current);
      setHeading(Math.round(h));
      setSpan(Math.round(hi.current - lo.current));
    };
    const onAbsolute = (e: DeviceOrientationEvent) => {
      if (e.alpha == null) return;
      take((360 - e.alpha) % 360, "deviceorientationabsolute");
    };
    const onOrientation = (e: DeviceOrientationEvent) => {
      const ios = (e as OrientationEventLike).webkitCompassHeading;
      if (typeof ios === "number" && ios >= 0) take(ios, "webkitCompassHeading");
      else if (e.absolute && e.alpha != null) take((360 - e.alpha) % 360, "deviceorientation(absolute)");
    };
    const onMotion = (e: DeviceMotionEvent) => {
      const r = e.rotationRate;
      if (!gotGyro && r && (r.alpha != null || r.beta != null || r.gamma != null)) {
        gotGyro = true;
        setGyro(true);
      }
    };
    window.addEventListener("deviceorientationabsolute" as "deviceorientation", onAbsolute);
    window.addEventListener("deviceorientation", onOrientation);
    window.addEventListener("devicemotion", onMotion);
    const timer = setTimeout(() => {
      if (!gotHeading) setCompass(false);
      if (!gotGyro) setGyro(false);
    }, WAIT_MS);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("deviceorientationabsolute" as "deviceorientation", onAbsolute);
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [phase]);

  const ask = async () => {
    const r = await requestMotionAccess(); // straight from the tap (iOS needs that)
    setPhase(r === "denied" ? "denied" : "listening");
  };

  const compassOk = compass === true && span >= NEED_DEG;
  const auto: Result | null = compassOk ? "pass" : compass === false ? "unsupported" : null;
  const detail = {
    magnetometer: compass,
    compassSpanDeg: span,
    compassSource: source,
    gyroscope: gyro,
    lightSensor: "not available in a browser",
    barometer: "not available in a browser",
    runtime: "browser",
  };

  if (phase !== "listening") {
    return (
      <TestShell {...p} instructions="Turn the phone a half-circle for the compass." hideManual detail={{ ...detail, permission: phase === "denied" ? "denied" : "not-asked" }}>
        <View style={s.wrap}>
          <Say center>{phase === "denied" ? MOTION_DENIED() : "Tap Start. If your phone asks to use motion and orientation, tap Allow."}</Say>
          <Big title={phase === "denied" ? "Ask again" : "Start"} onPress={ask} />
        </View>
      </TestShell>
    );
  }

  if (auto === "unsupported") {
    const reason = "This browser gives no compass reading.";
    return (
      <TestShell {...p} instructions={reason} autoVerdict="unsupported" hideManual detail={{ ...detail, reason }}>
        <CantBody emoji={p.test.emoji} reason={reason} />
      </TestShell>
    );
  }

  return (
    <TestShell {...p} instructions="Turn the phone slowly round in a half-circle, flat in your hand, for the compass." autoVerdict={auto} detail={detail}>
      <View style={s.wrap}>
        <Row label="Compass" value={compass == null ? "waiting…" : `${heading ?? "…"}° · turned ${span}° (need ${NEED_DEG}°)`} tone={compassOk ? "pass" : undefined} />
        <Row label="Gyroscope" value={gyro == null ? "…" : gyro ? "reporting" : "no data from the browser"} tone={gyro ? "pass" : gyro === false ? "skip" : undefined} />
        <Row label="Light sensor" value="not available in a browser" tone="skip" />
        <Row label="Barometer" value="not available in a browser" tone="skip" />
      </View>
    </TestShell>
  );
}
const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center", gap: 16 } });
