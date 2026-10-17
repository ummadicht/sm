// The battery-health screenshot, chosen from the phone's own pictures and made
// small enough to send: images only (expo-image-picker's system photo picker —
// no storage permission on Android 13+), the longest side at most 1600 px,
// JPEG at 0.6, as a data URL for POST /api/device/battery (≤ 3 MB). A picture
// still too big after that is tried once more, smaller, before giving up.
// The browser twin is ./batteryShot.web.ts (no file system there).
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as FS from "expo-file-system/legacy";
import { JPEG_QUALITY, MAX_DATA_URL_CHARS, MAX_EDGE_PX, fitWithin } from "./battery";

export type Shot = { kind: "ok"; dataUrl: string } | { kind: "canceled" } | { kind: "error"; message: string };

async function encode(uri: string, w: number, h: number, maxEdge: number, quality: number): Promise<string | null> {
  let ctx = ImageManipulator.manipulate(uri);
  const size = fitWithin(w, h, maxEdge);
  if (size) ctx = ctx.resize(size);
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ base64: true, format: SaveFormat.JPEG, compress: quality });
  // Only the data URL leaves this function; the resized copy is not kept on the phone.
  FS.deleteAsync(out.uri, { idempotent: true }).catch(() => {});
  return out.base64 ? `data:image/jpeg;base64,${out.base64}` : null;
}

export async function chooseScreenshot(): Promise<Shot> {
  let r: ImagePicker.ImagePickerResult;
  try {
    r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1, exif: false, base64: false });
  } catch {
    return { kind: "error", message: "Couldn't open your pictures. Try again." };
  }
  const a = r.canceled ? null : r.assets?.[0];
  if (!a?.uri) return { kind: "canceled" };
  try {
    let url = await encode(a.uri, a.width, a.height, MAX_EDGE_PX, JPEG_QUALITY);
    if (url && url.length > MAX_DATA_URL_CHARS) url = await encode(a.uri, a.width, a.height, 1200, 0.45);
    if (!url) return { kind: "error", message: "Couldn't read that picture. Choose the screenshot again." };
    if (url.length > MAX_DATA_URL_CHARS) return { kind: "error", message: "That picture is too big to send. Choose the screenshot itself, not a photo." };
    return { kind: "ok", dataUrl: url };
  } catch {
    return { kind: "error", message: "Couldn't read that picture. Choose the screenshot again." };
  }
}
