// Browser version of "blow out the candles": getUserMedia({audio}) feeds a
// Web Audio AnalyserNode and the level is the RMS of each window in dBFS
// (expo-audio's recorder metering is not reliable on the web). The browser's
// noise suppression / auto-gain are switched off — they are built to remove
// exactly the "blowing" sound this test listens for.
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { T } from "../../shared/theme";
import { Big, Say } from "../parts";
import { CantBody } from "../web/WebParts";
import { errName, hasGetUserMedia, mediaFailure, stopStream } from "../web/browser";

const CANDLES = 5;
const BLOW_DB = -22; // RMS dBFS; a close blow or loud voice is well above this, a quiet room ~ -50
const ABOVE_FLOOR_DB = 14; // and clearly louder than this room's own background

type Perm = "idle" | "asking" | "granted" | "denied" | "missing" | "error";

type AudioCtxCtor = typeof AudioContext;

export function MicTest(p: TestProps) {
  const [perm, setPerm] = useState<Perm>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [lit, setLit] = useState(CANDLES);
  const [db, setDb] = useState<number | null>(null);
  const [peak, setPeak] = useState(-160);
  const peakRef = useRef(-160);
  const floor = useRef<number | null>(null);
  const lastOut = useRef(0);
  const litRef = useRef(CANDLES);
  const done = useRef(false);
  const res = useRef<{ stream: MediaStream | null; ctx: AudioContext | null; timer: ReturnType<typeof setInterval> | null }>({ stream: null, ctx: null, timer: null });

  const teardown = () => {
    const r = res.current;
    if (r.timer) clearInterval(r.timer);
    stopStream(r.stream);
    r.ctx?.close().catch(() => {});
    res.current = { stream: null, ctx: null, timer: null };
  };
  useEffect(() => () => { done.current = true; teardown(); }, []);

  const start = async () => {
    setErr(null);
    setPerm("asking");
    // Create + resume the AudioContext inside the tap — iPhones keep it silent otherwise.
    const Ctor: AudioCtxCtor | undefined = (window as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext;
    if (!Ctor) { setPerm("error"); setErr("NoWebAudio"); return; }
    const ctx = new Ctor();
    ctx.resume().catch(() => {});
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      ctx.close().catch(() => {});
      const f = mediaFailure(e);
      setErr(errName(e));
      setPerm(f === "denied" ? "denied" : f === "missing" ? "missing" : "error");
      return;
    }
    if (done.current) { stopStream(stream); ctx.close().catch(() => {}); return; }
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);
    // Float samples where available (8-bit samples bottom out around -45 dB).
    const fbuf = typeof an.getFloatTimeDomainData === "function" ? new Float32Array(an.fftSize) : null;
    const bbuf = new Uint8Array(an.fftSize);
    const timer = setInterval(() => {
      let sum = 0;
      if (fbuf) {
        an.getFloatTimeDomainData(fbuf);
        for (let i = 0; i < fbuf.length; i++) sum += fbuf[i] * fbuf[i];
      } else {
        an.getByteTimeDomainData(bbuf);
        for (let i = 0; i < bbuf.length; i++) {
          const v = (bbuf[i] - 128) / 128;
          sum += v * v;
        }
      }
      const rms = Math.sqrt(sum / an.fftSize);
      const m = rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
      setDb(m);
      // Background level: a slow-moving minimum of what the room sounds like.
      floor.current = floor.current == null ? m : m < floor.current ? m : floor.current + 0.02 * (m - floor.current);
      if (m > peakRef.current) { peakRef.current = m; setPeak(m); }
      if (done.current) return;
      const loud = m > BLOW_DB && m > (floor.current ?? -100) + ABOVE_FLOOR_DB;
      if (loud && Date.now() - lastOut.current > 350) {
        lastOut.current = Date.now();
        litRef.current = Math.max(0, litRef.current - 1);
        setLit(litRef.current);
        if (litRef.current === 0) {
          done.current = true;
          setTimeout(() => p.onResult("pass", { peakDb: Math.round(peakRef.current), threshold: BLOW_DB, method: "webaudio-rms", runtime: "browser" }), 400);
        }
      }
    }, 60);
    res.current = { stream, ctx, timer };
    setPerm("granted");
  };

  const detail = { permission: perm, peakDb: peak > -160 ? Math.round(peak) : null, threshold: BLOW_DB, method: "webaudio-rms", error: err, runtime: "browser" };

  if (!hasGetUserMedia()) {
    const reason = "This browser can't open the microphone.";
    return (
      <TestShell {...p} instructions={reason} autoVerdict="unsupported" hideManual detail={{ ...detail, reason }}>
        <CantBody emoji={p.test.emoji} />
      </TestShell>
    );
  }

  const level = db == null ? 0 : Math.max(0, Math.min(1, (db + 60) / 60));
  return (
    <TestShell {...p} instructions="Blow (or speak loudly) into the bottom microphone until all five candles go out." detail={detail}>
      <View style={s.wrap}>
        <View style={s.candles}>
          {Array.from({ length: CANDLES }).map((_, i) => (
            <Text key={i} style={s.candle}>{i < lit ? "🕯️" : "💨"}</Text>
          ))}
        </View>
        {perm === "granted" ? (
          <>
            <View style={s.meter}><View style={[s.meterFill, { width: `${level * 100}%` }]} /></View>
            <Text style={s.meta}>{db == null ? "Listening…" : `${db.toFixed(0)} dB · peak ${peak > -160 ? peak.toFixed(0) : "…"} dB`}</Text>
          </>
        ) : perm === "denied" ? (
          <>
            <Say center>The microphone was blocked. Allow it for this page (tap the lock or ⓘ next to the address), then try again — or skip.</Say>
            <Big title="Try again" onPress={start} />
          </>
        ) : perm === "missing" || perm === "error" ? (
          <>
            <Say center>{perm === "missing" ? "Your browser found no microphone on this phone." : "The microphone wouldn't start."} If the test still can't hear you, press Fail.</Say>
            <Big title="Try again" onPress={start} />
          </>
        ) : (
          <>
            <Say center>Your phone will ask to use the microphone. Tap Allow.</Say>
            <Big title={perm === "asking" ? "Starting…" : "Start the microphone"} onPress={start} busy={perm === "asking"} />
          </>
        )}
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", gap: 24 },
  candles: { flexDirection: "row", justifyContent: "center", gap: 6 },
  candle: { fontSize: 44 },
  meter: { height: 14, borderRadius: 7, backgroundColor: T.surface2, overflow: "hidden" },
  meterFill: { height: "100%", backgroundColor: T.pass },
  meta: { color: T.muted, textAlign: "center" },
});
