// Cameras and flashlight, judged from the pictures themselves: each capture is
// shrunk to 32 px wide, decoded (jpeg-js) and reduced to a luminance mean and
// standard deviation (./analysis). A frame with detail = the camera sees; a
// black / even frame = covered or too dark (retried once, then "not tested").
// Native only.
import React, { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Camera, CameraView } from "expo-camera";
import * as FS from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as jpeg from "jpeg-js";
import { T } from "../../shared/theme";
import { type FrameStats, type SideResult, type Verdict, base64ToBytes, cameraNeedsRetry, cameraVerdict, flashVerdict, frameKind, luminanceStats } from "./analysis";
import { hasFeature, sleep, within } from "./steps";

type Facing = "back" | "front";

// @types/jpeg-js describes 0.3 (a boolean 2nd argument); 0.4 takes options. Without
// useTArray it allocates a Node Buffer, which React Native doesn't have.
const decodeJpeg = jpeg.decode as unknown as (data: Uint8Array, opts: { useTArray: true; formatAsRGBA: true }) => { width: number; height: number; data: Uint8Array };

const READY_TIMEOUT_MS = 10_000;

export type CameraRig = {
  /** Mount the preview for `facing` (fresh session) and wait until it is ready. */
  open(facing: Facing): Promise<"ready" | "timeout" | { error: string }>;
  setTorch(on: boolean): void;
  /** One frame → luminance stats. Throws when the camera can't capture. */
  frame(): Promise<FrameStats>;
  close(): void;
  /** Render this somewhere on screen while a camera step runs (a small live preview). */
  view: React.ReactNode;
};

export function useCameraRig(): CameraRig {
  const [cam, setCam] = useState<{ facing: Facing; key: number; torch: boolean } | null>(null);
  const ref = useRef<CameraView>(null);
  const waiter = useRef<{ key: number; done: (r: "ready" | { error: string }) => void } | null>(null);
  const keyRef = useRef(0);

  const open = useCallback(async (facing: Facing) => {
    const key = ++keyRef.current;
    const p = new Promise<"ready" | { error: string }>((resolve) => {
      waiter.current = { key, done: resolve };
    });
    setCam({ facing, key, torch: false });
    const r = await within<"ready" | { error: string } | "timeout">(p, READY_TIMEOUT_MS, "timeout");
    if (waiter.current?.key === key) waiter.current = null;
    return r;
  }, []);

  const setTorch = useCallback((on: boolean) => setCam((c) => (c ? { ...c, torch: on } : c)), []);
  const close = useCallback(() => {
    waiter.current = null;
    setCam(null);
  }, []);

  const frame = useCallback(async (): Promise<FrameStats> => {
    const c = ref.current;
    if (!c) throw new Error("camera not open");
    const pic = await c.takePictureAsync({ quality: 0.1, skipProcessing: true, shutterSound: false });
    if (!pic?.uri) throw new Error("no picture returned");
    let small: string | null = null;
    try {
      const img = await ImageManipulator.manipulate(pic.uri).resize({ width: 32 }).renderAsync();
      const out = await img.saveAsync({ base64: true, format: SaveFormat.JPEG, compress: 0.9 });
      small = out.uri;
      if (!out.base64) throw new Error("no image data");
      const raw = decodeJpeg(base64ToBytes(out.base64), { useTArray: true, formatAsRGBA: true });
      return luminanceStats(raw.data, raw.width, raw.height);
    } finally {
      // Nothing from the cameras is kept or sent — only the two numbers above.
      FS.deleteAsync(pic.uri, { idempotent: true }).catch(() => {});
      if (small) FS.deleteAsync(small, { idempotent: true }).catch(() => {});
    }
  }, []);

  const view = cam ? (
    <View style={s.wrap}>
      <CameraView
        key={cam.key}
        ref={ref}
        style={s.cam}
        facing={cam.facing}
        enableTorch={cam.torch}
        animateShutter={false}
        onCameraReady={() => {
          const w = waiter.current;
          if (w && w.key === cam.key) w.done("ready");
        }}
        onMountError={(e) => {
          const w = waiter.current;
          if (w && w.key === cam.key) w.done({ error: e?.message || "the camera could not start" });
        }}
      />
    </View>
  ) : null;

  return useMemo(() => ({ open, setTorch, frame, close, view }), [open, setTorch, frame, close, view]);
}

async function cameraGranted(): Promise<boolean> {
  const p = await within(Camera.getCameraPermissionsAsync().then((x) => x as { granted: boolean } | null), 3000, null);
  return !!p?.granted;
}

/** Let auto-exposure settle before judging a frame. */
const SETTLE_MS = 700;

async function shoot(rig: CameraRig, facing: Facing): Promise<SideResult> {
  const r = await rig.open(facing);
  if (r === "timeout") return { status: "timeout" };
  if (r !== "ready") return { status: "error", message: r.error };
  await sleep(SETTLE_MS);
  try {
    return { status: "ok", stats: await rig.frame() };
  } catch (e) {
    return { status: "error", message: String((e as Error)?.message ?? e).slice(0, 160) };
  }
}

/**
 * Rear then front. If either frame was too dark / even (lying on the counter,
 * a finger over the lens), ask for the phone to be held up and retry that side once.
 */
export async function cameraStep(rig: CameraRig, say: (line: string | null) => void): Promise<Verdict> {
  if (!(await cameraGranted())) return { outcome: "skip", detail: { method: "capture → 32 px → luminance", reason: "camera permission refused" } };
  try {
    let rear = await shoot(rig, "back");
    let front = await shoot(rig, "front");
    let attempts = 1;
    if (cameraNeedsRetry(rear, front)) {
      attempts = 2;
      say("Hold the phone up so both cameras can see the room");
      rig.close();
      await sleep(4000);
      const bad = (r: SideResult) => r.status !== "ok" || frameKind(r.stats) !== "scene";
      if (bad(rear)) rear = await shoot(rig, "back");
      if (bad(front)) front = await shoot(rig, "front");
    }
    return cameraVerdict(rear, front, attempts);
  } finally {
    say(null);
    rig.close();
  }
}

/** Rear frame with the torch off, then on. Best while the phone lies screen-up (the lens faces the counter). */
export async function flashStep(rig: CameraRig): Promise<Verdict> {
  const method = "rear frame, torch off vs on";
  if ((await hasFeature("android.hardware.camera.flash")) === false) {
    return { outcome: "unsupported", detail: { method, reason: "this phone has no camera flash" } };
  }
  if (!(await cameraGranted())) return { outcome: "skip", detail: { method, reason: "camera permission refused" } };
  try {
    const r = await rig.open("back");
    if (r === "timeout") return { outcome: "skip", detail: { method, reason: "the rear camera did not get ready in time" } };
    if (r !== "ready") return flashVerdict(null, null, `the rear camera could not start: ${r.error}`);
    await sleep(SETTLE_MS);
    let off: FrameStats;
    try {
      off = await rig.frame();
    } catch (e) {
      return { outcome: "skip", detail: { method, reason: `no frame with the torch off: ${String((e as Error)?.message ?? e).slice(0, 120)}` } };
    }
    rig.setTorch(true);
    await sleep(1200);
    let on: FrameStats;
    try {
      on = await rig.frame();
    } catch (e) {
      return flashVerdict(null, null, String((e as Error)?.message ?? e).slice(0, 160));
    }
    return flashVerdict(off, on, null);
  } finally {
    rig.setTorch(false);
    rig.close();
  }
}

const s = StyleSheet.create({
  wrap: { width: 96, height: 128, borderRadius: 12, overflow: "hidden", backgroundColor: "#000", borderWidth: 1, borderColor: T.border },
  cam: { flex: 1 },
});
