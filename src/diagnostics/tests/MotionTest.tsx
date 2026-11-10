import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Accelerometer, Gyroscope } from "expo-sensors";
import { TestProps, TestShell } from "../TestShell";
import { T } from "../../shared/theme";

const BALL = 36, TARGET = 90;

// Tilt-to-roll. Accelerometer drives the ball; the gyroscope is probed for
// availability and reported. A device that never moves the ball is a fail.
export function MotionTest(p: TestProps) {
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [target, setTarget] = useState({ x: 0.5, y: 0.25 });
  const [avail, setAvail] = useState<{ accel: boolean | null; gyro: boolean | null }>({ accel: null, gyro: null });
  const [samples, setSamples] = useState(0);
  const vel = useRef({ x: 0, y: 0 });
  const posRef = useRef({ x: 0, y: 0 });
  const targetRef = useRef({ x: 0.5, y: 0.25 });
  const inSince = useRef<number | null>(null);
  const done = useRef(false);
  const maxTilt = useRef(0);

  useEffect(() => {
    Accelerometer.isAvailableAsync().then((a) => setAvail((v) => ({ ...v, accel: a })));
    Gyroscope.isAvailableAsync().then((g) => setAvail((v) => ({ ...v, gyro: g })));
  }, []);

  useEffect(() => {
    if (!area.w) return;
    posRef.current = { x: area.w / 2 - BALL / 2, y: area.h / 2 - BALL / 2 };
    const nextTarget = { x: 0.2 + Math.random() * 0.6, y: 0.15 + Math.random() * 0.7 };
    targetRef.current = nextTarget;
    setTarget(nextTarget);
    Accelerometer.setUpdateInterval(40);
    const sub = Accelerometer.addListener(({ x, y }) => {
      setSamples((n) => n + 1);
      maxTilt.current = Math.max(maxTilt.current, Math.abs(x), Math.abs(y));
      // x: left/right tilt, y: toward/away (sign differs per platform; both are fine for a game)
      vel.current.x = vel.current.x * 0.9 + x * -9;
      vel.current.y = vel.current.y * 0.9 + y * 9;
      const nx = Math.max(0, Math.min(area.w - BALL, posRef.current.x + vel.current.x));
      const ny = Math.max(0, Math.min(area.h - BALL, posRef.current.y + vel.current.y));
      posRef.current = { x: nx, y: ny };
      setPos(posRef.current);
      const tx = targetRef.current.x * area.w, ty = targetRef.current.y * area.h;
      const cx = nx + BALL / 2, cy = ny + BALL / 2;
      const inside = Math.hypot(cx - tx, cy - ty) < TARGET / 2 - BALL / 4;
      if (inside) {
        if (inSince.current == null) inSince.current = Date.now();
        else if (Date.now() - inSince.current > 600 && !done.current) {
          done.current = true;
          p.onResult("pass", { accelerometer: true, gyroscope: avail.gyro, maxTiltG: Number(maxTilt.current.toFixed(2)) });
        }
      } else inSince.current = null;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area.w, area.h]);

  const auto = avail.accel === false ? "fail" : null;
  return (
    <TestShell {...p} instructions="Tilt the phone to roll the ball into the ring and hold it there." autoVerdict={auto} detail={{ accelerometer: avail.accel, gyroscope: avail.gyro, samples }}>
      <View style={s.arena} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {area.w > 0 && (
          <>
            <View style={[s.target, { left: target.x * area.w - TARGET / 2, top: target.y * area.h - TARGET / 2 }]} />
            <View style={[s.ball, { left: pos.x, top: pos.y }]} />
          </>
        )}
        <Text style={s.meta}>accelerometer {avail.accel == null ? "…" : avail.accel ? "✓" : "✗"} · gyroscope {avail.gyro == null ? "…" : avail.gyro ? "✓" : "✗"} · {samples} samples</Text>
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({
  arena: { flex: 1, backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.border, overflow: "hidden" },
  target: { position: "absolute", width: TARGET, height: TARGET, borderRadius: TARGET / 2, borderWidth: 4, borderColor: T.pass, borderStyle: "dashed" },
  ball: { position: "absolute", width: BALL, height: BALL, borderRadius: BALL / 2, backgroundColor: T.accent, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 6 },
  meta: { position: "absolute", bottom: 8, alignSelf: "center", color: T.muted, fontSize: 12 },
});
