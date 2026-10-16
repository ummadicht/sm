// Browser version of "shoot both sides": getUserMedia opens the rear
// ("environment") then the front ("user") camera with a live preview; a tap
// grabs the frame onto a canvas. The customer then judges both photos. If a
// side won't open, or the customer says one looks wrong, the result carries
// detail.side (rear / front / both) — the server maps that to the right fault.
import React, { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { T } from "../../shared/theme";
import { Big, Say } from "../parts";
import { CantBody, captureFrame } from "../web/WebParts";
import { errName, hasGetUserMedia, mediaFailure, stopStream } from "../web/browser";
import { Detail } from "../../shared/types";

type Side = "back" | "front";
type Open = "ok" | "denied" | "missing" | "busy" | "other" | "wrong-side" | "reported-broken";
const WANT: Record<Side, "environment" | "user"> = { back: "environment", front: "user" };
const LABEL: Record<Side, string> = { back: "rear", front: "front" };

export function CameraTest(p: TestProps) {
  const supported = hasGetUserMedia();
  const [step, setStep] = useState<Side | "judge">("back");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [opening, setOpening] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<Partial<Record<Side, Open>>>({});
  const [errs, setErrs] = useState<Partial<Record<Side, string>>>({});
  const [facing, setFacing] = useState<Partial<Record<Side, string>>>({});
  const [shots, setShots] = useState<Partial<Record<Side, { url: string; dark: boolean }>>>({});
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const live = useRef<MediaStream | null>(null);

  useEffect(() => () => stopStream(live.current), []);

  // Open the camera for the current side.
  useEffect(() => {
    if (!supported || step === "judge") return;
    let alive = true;
    const side = step;
    stopStream(live.current);
    live.current = null;
    setStream(null);
    setOpening(true);
    (async () => {
      const gum = (video: MediaTrackConstraints) => navigator.mediaDevices.getUserMedia({ video, audio: false });
      let s: MediaStream | null = null;
      let err: unknown = null;
      try {
        s = await gum({ facingMode: { exact: WANT[side] } });
      } catch (e) {
        // Some browsers can't match "exact" — ask again more loosely and check what we got.
        if (mediaFailure(e) === "missing") {
          try {
            s = await gum({ facingMode: { ideal: WANT[side] } });
          } catch (e2) {
            err = e2;
          }
        } else err = e;
      }
      if (!alive) { stopStream(s); return; }
      setOpening(false);
      if (!s) {
        setOpen((o) => ({ ...o, [side]: mediaFailure(err) }));
        setErrs((x) => ({ ...x, [side]: errName(err) }));
        return;
      }
      const got = s.getVideoTracks()[0]?.getSettings?.().facingMode;
      if ((got === "user" || got === "environment") && got !== WANT[side]) {
        // The browser handed us the other camera: this side can't be reached.
        stopStream(s);
        setOpen((o) => ({ ...o, [side]: "wrong-side" }));
        setErrs((x) => ({ ...x, [side]: `got ${got}` }));
        return;
      }
      setFacing((f) => ({ ...f, [side]: got || "unknown" }));
      setOpen((o) => ({ ...o, [side]: "ok" }));
      live.current = s;
      setStream(s);
    })();
    return () => { alive = false; };
  }, [supported, step, attempt]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) v.play().catch(() => {});
  }, [stream]);

  const next = (side: Side) => {
    stopStream(live.current);
    live.current = null;
    setStream(null);
    setStep(side === "back" ? "front" : "judge");
  };
  const capture = () => {
    if (step === "judge" || !videoRef.current) return;
    const f = captureFrame(videoRef.current);
    if (!f) return;
    setShots((x) => ({ ...x, [step]: f }));
    next(step);
  };
  const broken = () => {
    if (step === "judge") return;
    setOpen((o) => ({ ...o, [step]: "reported-broken" }));
    next(step);
  };

  const detail: Detail = {
    rearCaptured: !!shots.back,
    frontCaptured: !!shots.front,
    rearOpen: open.back ?? null,
    frontOpen: open.front ?? null,
    rearError: errs.back ?? null,
    frontError: errs.front ?? null,
    rearFacing: facing.back ?? null,
    frontFacing: facing.front ?? null,
    rearDark: shots.back ? shots.back.dark : null,
    frontDark: shots.front ? shots.front.dark : null,
    runtime: "browser",
  };
  const fail = (side: "rear" | "front" | "both") => p.onResult("fail", { ...detail, side });

  if (!supported) {
    const reason = "This browser can't open the cameras.";
    return (
      <TestShell {...p} instructions={reason} autoVerdict="unsupported" hideManual detail={{ ...detail, reason }}>
        <CantBody emoji={p.test.emoji} />
      </TestShell>
    );
  }

  if (step === "judge") {
    const both = !!shots.back && !!shots.front;
    const notes = (["back", "front"] as const)
      .filter((sd) => !shots[sd])
      .map((sd) => `The ${LABEL[sd]} camera ${open[sd] === "reported-broken" ? "was reported not working" : "wouldn't open"}.`);
    for (const sd of ["back", "front"] as const) if (shots[sd]?.dark) notes.push(`The ${LABEL[sd]} photo is completely black.`);
    return (
      <TestShell {...p} instructions="Check both photos: sharp, no black spots, no colour cast, no cracks showing through the lens." hideManual detail={detail}>
        <View style={{ flex: 1, gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {(["back", "front"] as const).map((sd) => (
              <View key={sd} style={s.thumbWrap}>
                {shots[sd] ? (
                  <Image source={{ uri: shots[sd]!.url }} style={s.thumb} resizeMode="cover" />
                ) : (
                  <View style={[s.thumb, { alignItems: "center", justifyContent: "center" }]}><Text style={{ color: T.muted }}>no photo</Text></View>
                )}
                <Text style={s.cap}>{sd === "back" ? "Rear" : "Front"}</Text>
              </View>
            ))}
          </View>
          {notes.map((n) => <Say key={n} muted center style={{ fontSize: 15 }}>{n}</Say>)}
          <Big title="Both photos look right" kind="pass" disabled={!both} onPress={() => p.onResult("pass", detail)} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Big title="Rear has a problem" kind="secondary" onPress={() => fail("rear")} style={{ flex: 1 }} />
            <Big title="Front has a problem" kind="secondary" onPress={() => fail("front")} style={{ flex: 1 }} />
          </View>
          <Big title="Both have a problem" kind="fail" onPress={() => fail("both")} />
        </View>
      </TestShell>
    );
  }

  const side = step;
  const state = open[side];
  return (
    <TestShell {...p} instructions={`Point the ${side === "back" ? "REAR (back)" : "FRONT (selfie)"} camera at something detailed and take a photo.`} hideManual detail={detail}>
      <View style={{ flex: 1, gap: 10 }}>
        <View style={s.preview}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000", transform: side === "front" ? "scaleX(-1)" : undefined }}
          />
          {!stream ? (
            <View style={s.overlay}>
              <Text style={s.overlayText}>
                {opening ? `Opening the ${LABEL[side]} camera…`
                  : state === "denied" ? "The camera was blocked. Allow it for this page (tap the lock or ⓘ next to the address), then tap Try again."
                  : state === "wrong-side" ? `Your browser couldn't reach the ${LABEL[side]} camera.`
                  : state ? `The ${LABEL[side]} camera wouldn't open${errs[side] ? ` (${errs[side]})` : ""}.`
                  : ""}
              </Text>
            </View>
          ) : null}
        </View>
        {stream ? (
          <Big title={`Take the ${LABEL[side]} photo`} onPress={capture} />
        ) : !opening ? (
          <Big title="Try again" onPress={() => setAttempt((a) => a + 1)} />
        ) : null}
        <Big title={`The ${LABEL[side]} camera isn't working`} kind="quiet" onPress={broken} disabled={opening} />
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({
  preview: { flex: 1, minHeight: 220, borderRadius: T.radius, overflow: "hidden", backgroundColor: "#000" },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: 20 },
  overlayText: { color: "#fff", fontSize: 17, lineHeight: 24, textAlign: "center" },
  thumbWrap: { flex: 1, gap: 4 },
  thumb: { height: 150, borderRadius: 10, backgroundColor: T.surface2 },
  cap: { color: T.muted, fontSize: 13, textAlign: "center" },
});
