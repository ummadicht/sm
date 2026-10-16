// Browser version of tilt-to-roll. The ball is driven by DeviceOrientation
// (beta/gamma — same sign on Android and iPhone) measured from how the phone
// was held when the test started; DeviceMotion is read alongside to report the
// accelerometer and gyroscope. iPhones only send motion data after the user
// taps (DeviceMotionEvent.requestPermission). No data within ~3 s → the browser
// can't test it ("unsupported"), never a fail.
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { T } from "../../shared/theme";
import { Big, Say } from "../parts";
import { CantBody } from "../web/WebParts";
import { isIOS, MOTION_DENIED, motionNeedsTap, requestMotionAccess } from "../web/browser";

const BALL = 36, TARGET = 90;
const WAIT_MS = 3000;
const rad = (d: number) => (d * Math.PI) / 180;

type Phase = "tap" | "listening" | "running" | "none" | "denied";

export function MotionTest(p: TestProps) {
  const [phase, setPhase] = useState<Phase>(() => (motionNeedsTap() ? "tap" : "listening"));
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [target, setTarget] = useState({ x: 0.5, y: 0.25 });
  const [seen, setSeen] = useState({ accel: false, gyro: false, orientation: false });
  const [samples, setSamples] = useState(0);
  const areaRef = useRef(area);
  const targetRef = useRef(target);
  const seenRef = useRef(seen);
  const vel = useRef({ x: 0, y: 0 });
  const posRef = useRef({ x: 0, y: 0 });
  const neutral = useRef<number | null>(null);
  const last = useRef(0);
  const inSince = useRef<number | null>(null);
  const done = useRef(false);
  const maxTilt = useRef(0);
  areaRef.current = area;
  targetRef.current = target;

  useEffect(() => {
    if (!area.w) return;
    posRef.current = { x: area.w / 2 - BALL / 2, y: area.h / 2 - BALL / 2 };
    setPos(posRef.current);
    setTarget({ x: 0.2 + Math.random() * 0.6, y: 0.15 + Math.random() * 0.7 });
  }, [area.w, area.h]);

  useEffect(() => {
    if (phase !== "listening" && phase !== "running") return;
    let gotData = false;
    const mark = (k: "accel" | "gyro" | "orientation") => {
      if (seenRef.current[k]) return;
      seenRef.current = { ...seenRef.current, [k]: true };
      setSeen(seenRef.current);
    };
    const step = (ax: number, ay: number) => {
      const a = areaRef.current;
      if (!a.w || done.current) return;
      const now = performance.now();
      const f = last.current ? Math.min(3, (now - last.current) / 40) : 1; // native steps every 40 ms
      last.current = now;
      vel.current.x = vel.current.x * Math.pow(0.9, f) + ax * 9 * f;
      vel.current.y = vel.current.y * Math.pow(0.9, f) + ay * 9 * f;
      const nx = Math.max(0, Math.min(a.w - BALL, posRef.current.x + vel.current.x * f));
      const ny = Math.max(0, Math.min(a.h - BALL, posRef.current.y + vel.current.y * f));
      posRef.current = { x: nx, y: ny };
      setPos(posRef.current);
      setSamples((n) => n + 1);
      const t = targetRef.current;
      const inside = Math.hypot(nx + BALL / 2 - t.x * a.w, ny + BALL / 2 - t.y * a.h) < TARGET / 2 - BALL / 4;
      if (inside) {
        if (inSince.current == null) inSince.current = Date.now();
        else if (Date.now() - inSince.current > 600 && !done.current) {
          done.current = true;
          const s = seenRef.current;
          p.onResult("pass", { accelerometer: s.accel, gyroscope: s.gyro, orientation: s.orientation, maxTiltDeg: Math.round(maxTilt.current), runtime: "browser" });
        }
      } else inSince.current = null;
    };
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      gotData = true;
      mark("orientation");
      setPhase("running");
      if (neutral.current == null) neutral.current = e.beta;
      const fb = Math.max(-90, Math.min(90, e.beta - neutral.current));
      maxTilt.current = Math.max(maxTilt.current, Math.abs(fb), Math.abs(e.gamma));
      step(Math.sin(rad(e.gamma)), Math.sin(rad(fb)));
    };
    const onMotion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (g && g.x != null && g.y != null) {
        gotData = true;
        mark("accel");
        setPhase("running");
        // Rare: motion but no orientation events — roll the ball from the
        // accelerometer instead (Android sign convention; Safari's is flipped).
        if (!seenRef.current.orientation) {
          const k = isIOS() ? -1 : 1;
          step((-g.x / 9.81) * k, (g.y / 9.81) * k);
        }
      }
      const r = e.rotationRate;
      if (r && (r.alpha != null || r.beta != null || r.gamma != null)) mark("gyro");
    };
    window.addEventListener("deviceorientation", onOrientation);
    window.addEventListener("devicemotion", onMotion);
    const timer = setTimeout(() => {
      if (!gotData) setPhase("none");
    }, WAIT_MS);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("devicemotion", onMotion);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "listening" || phase === "running"]);

  const ask = async () => {
    const r = await requestMotionAccess(); // called straight from the tap (iOS needs that)
    setPhase(r === "denied" ? "denied" : "listening");
  };

  const detail = { accelerometer: seen.accel, gyroscope: seen.gyro, orientation: seen.orientation, samples, runtime: "browser" };

  if (phase === "none") {
    const reason = "This browser sends no tilt-sensor data.";
    return (
      <TestShell {...p} instructions={reason} autoVerdict="unsupported" hideManual detail={{ ...detail, reason }}>
        <CantBody emoji={p.test.emoji} />
      </TestShell>
    );
  }
  if (phase === "tap" || phase === "denied") {
    return (
      <TestShell {...p} instructions="Tilt the phone to roll the ball into the ring and hold it there." hideManual detail={{ ...detail, permission: phase === "denied" ? "denied" : "not-asked" }}>
        <View style={s.wrap}>
          {phase === "denied" ? <Say center>{MOTION_DENIED()}</Say> : <Say center>Tap Start. If your phone asks to use motion, tap Allow.</Say>}
          <Big title={phase === "denied" ? "Ask again" : "Start"} onPress={ask} />
        </View>
      </TestShell>
    );
  }

  return (
    <TestShell {...p} instructions="Tilt the phone to roll the ball into the ring and hold it there." detail={detail}>
      <View style={s.arena} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {area.w > 0 && (
          <>
            <View style={[s.target, { left: target.x * area.w - TARGET / 2, top: target.y * area.h - TARGET / 2 }]} />
            <View style={[s.ball, { left: pos.x, top: pos.y }]} />
          </>
        )}
        <Text style={s.meta}>
          {phase === "listening" ? "Waiting for the tilt sensor…" : `tilt ${seen.orientation ? "✓" : "…"} · accelerometer ${seen.accel ? "✓" : "…"} · gyroscope ${seen.gyro ? "✓" : "…"} · ${samples}`}
        </Text>
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", gap: 16 },
  arena: { flex: 1, backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.border, overflow: "hidden" },
  target: { position: "absolute", width: TARGET, height: TARGET, borderRadius: TARGET / 2, borderWidth: 4, borderColor: T.pass, borderStyle: "dashed" },
  ball: { position: "absolute", width: BALL, height: BALL, borderRadius: BALL / 2, backgroundColor: T.accent },
  meta: { position: "absolute", bottom: 8, alignSelf: "center", color: T.muted, fontSize: 12 },
});
