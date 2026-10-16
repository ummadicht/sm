// Browser version of the flashlight test. A page can only switch the torch on
// through the rear camera's video track, and only where the browser exposes a
// "torch" capability (Chrome on Android). No torch capability → the browser
// can't test it (iPhone Safari, desktops). The customer confirms the light.
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { Big, BigEmoji, Say } from "../parts";
import { CantBody, LiveVideo } from "../web/WebParts";
import { errName, hasGetUserMedia, mediaFailure, stopStream } from "../web/browser";

type Phase = "idle" | "starting" | "ready" | "no-torch" | "denied" | "error";

type TorchCaps = MediaTrackCapabilities & { torch?: boolean };

function torchCapable(t: MediaStreamTrack): boolean {
  if (typeof t.getCapabilities !== "function") return false;
  try {
    return !!(t.getCapabilities() as TorchCaps).torch;
  } catch {
    return false;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Browsers that don't even know the "torch" constraint can be ruled out without asking for the camera. */
function torchKnown(): boolean {
  try {
    const c = navigator.mediaDevices.getSupportedConstraints?.() as (MediaTrackSupportedConstraints & { torch?: boolean }) | undefined;
    return !c || !!c.torch;
  } catch {
    return true;
  }
}

export function FlashTest(p: TestProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [on, setOn] = useState(false);
  const [toggles, setToggles] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const live = useRef<MediaStream | null>(null);
  const alive = useRef(true);

  useEffect(() => () => {
    alive.current = false;
    const t = track.current;
    if (t) t.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => {});
    stopStream(live.current);
  }, []);

  const setTorch = async (v: boolean) => {
    const t = track.current;
    if (!t) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: v } as MediaTrackConstraintSet] });
      setOn(v);
      setToggles((n) => n + 1);
    } catch (e) {
      setErr(errName(e));
    }
  };

  const start = async () => {
    setErr(null);
    setPhase("starting");
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (e) {
      setErr(errName(e));
      setPhase(mediaFailure(e) === "denied" ? "denied" : "error");
      return;
    }
    if (!alive.current) { stopStream(s); return; }
    live.current = s;
    setStream(s);
    const t = s.getVideoTracks()[0] ?? null;
    // Chrome only lists "torch" once the camera is actually delivering frames.
    let ok = false;
    for (let i = 0; i < 8 && t && !ok; i++) {
      ok = torchCapable(t);
      if (!ok) await wait(250);
    }
    if (!alive.current) return;
    if (!t || !ok) {
      stopStream(s);
      live.current = null;
      setStream(null);
      setPhase("no-torch");
      return;
    }
    track.current = t;
    setPhase("ready");
    await setTorch(true);
  };

  const detail = { torchCapability: phase === "ready" ? true : phase === "no-torch" ? false : null, toggled: toggles, on, error: err, runtime: "browser" };

  const known = hasGetUserMedia() && torchKnown();
  if (!known || phase === "no-torch") {
    const reason = hasGetUserMedia() ? "This browser can't switch on the light on the back of the phone." : "This browser can't open the camera that drives the light.";
    return (
      <TestShell {...p} instructions={reason} autoVerdict="unsupported" hideManual detail={{ ...detail, reason }}>
        <CantBody emoji={p.test.emoji} reason={reason} />
      </TestShell>
    );
  }

  return (
    <TestShell {...p} instructions="The light on the back of the phone should come on instantly, steady and bright." hideManual detail={detail}>
      <View style={s.wrap}>
        <LiveVideo stream={stream} hidden />
        <BigEmoji>{on ? "🔦" : "⚫"}</BigEmoji>
        {phase === "ready" ? (
          <>
            <Big title={on ? "Turn the light off" : "Turn the light on"} kind="secondary" onPress={() => setTorch(!on)} />
            <Say center>Did the light on the back come on?</Say>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Big title="No" kind="fail" onPress={() => p.onResult("fail", detail)} style={{ flex: 1 }} />
              <Big title="Yes" kind="pass" onPress={() => p.onResult("pass", detail)} style={{ flex: 1.4 }} />
            </View>
          </>
        ) : phase === "denied" ? (
          <>
            <Say center>The camera was blocked — the light is part of it. Allow the camera for this page, then try again, or skip.</Say>
            <Big title="Try again" onPress={start} />
          </>
        ) : phase === "error" ? (
          <>
            <Say center>The camera wouldn't start{err ? ` (${err})` : ""}. Try again — or, if the light never comes on, say so below.</Say>
            <Big title="Try again" onPress={start} />
            <Big title="The light doesn't work" kind="quiet" onPress={() => p.onResult("fail", detail)} />
          </>
        ) : (
          <>
            <Say center>Your phone may ask to use the camera — the light is part of it. Tap Allow.</Say>
            <Big title={phase === "starting" ? "Starting…" : "Turn the light on"} onPress={start} busy={phase === "starting"} />
          </>
        )}
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center", gap: 16 } });
