// Browser twin of ./ImeiCamera.tsx (the browser Store, /app/store/): no barcode scan here — the
// tablet app scans. "Read the screen" opens the browser's own camera (a file input with
// capture="environment", through expo-image-picker) for one photo of the *#06# screen, made small
// enough to send to the server's reader; typing stays beside it on the card.
import React from "react";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { JPEG_QUALITY, MAX_DATA_URL_CHARS, MAX_EDGE_PX, fitWithin } from "../../check/battery";
import { Btn } from "../ui";
import type { ImeiCameraProps } from "./ImeiCamera";

async function photoDataUrl(uri: string, w: number, h: number): Promise<string | null> {
  let ctx = ImageManipulator.manipulate(uri);
  // The browser doesn't always know the size up front; the rendered image does.
  let size = fitWithin(w, h, MAX_EDGE_PX);
  if (!size && !(w > 0 && h > 0)) {
    const probe = await ImageManipulator.manipulate(uri).renderAsync();
    size = fitWithin(probe.width, probe.height, MAX_EDGE_PX);
  }
  if (size) ctx = ctx.resize(size);
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ base64: true, format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  if (/^blob:/.test(out.uri)) {
    try {
      URL.revokeObjectURL(out.uri);
    } catch {
      /* tidy-up only */
    }
  }
  return out.base64 ? `data:image/jpeg;base64,${out.base64}` : null;
}

export function ImeiCamera({ disabled, reading, onPhoto, onError }: ImeiCameraProps) {
  async function snap() {
    let r: ImagePicker.ImagePickerResult;
    try {
      // Straight from the tap — browsers only open the camera on a user gesture.
      r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], cameraType: ImagePicker.CameraType.back, allowsEditing: false, quality: 1, base64: false });
    } catch {
      onError("Couldn't open the camera — type the IMEI.");
      return;
    }
    const a = r.canceled ? null : r.assets?.[0];
    if (!a?.uri) return;
    try {
      const url = await photoDataUrl(a.uri, a.width, a.height);
      if (!url || url.length > MAX_DATA_URL_CHARS) throw new Error("unreadable");
      onPhoto(url);
    } catch {
      onError("Couldn't read that photo — try again or type it.");
    }
  }
  return <Btn title="Read the screen" kind="secondary" onPress={() => void snap()} busy={reading} disabled={disabled} style={{ alignSelf: "flex-start" }} />;
}
