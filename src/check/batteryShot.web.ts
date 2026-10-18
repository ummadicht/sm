// Browser twin of ./batteryShot.ts: expo-image-picker's web picker is a file
// input (images only) and expo-image-manipulator draws on a canvas, so the same
// size rules apply — the longest side at most 1600 px, JPEG at 0.6, ≤ 3 MB as a
// data URL. There is no file system to tidy up here.
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { JPEG_QUALITY, MAX_DATA_URL_CHARS, MAX_EDGE_PX, fitWithin } from "./battery";

export type Shot = { kind: "ok"; dataUrl: string } | { kind: "canceled" } | { kind: "error"; message: string };

async function encode(uri: string, w: number, h: number, maxEdge: number, quality: number): Promise<string | null> {
  let ctx = ImageManipulator.manipulate(uri);
  // The web picker doesn't always know the size up front; the rendered image does.
  let size = fitWithin(w, h, maxEdge);
  if (!size && !(w > 0 && h > 0)) {
    const probe = await ImageManipulator.manipulate(uri).renderAsync();
    size = fitWithin(probe.width, probe.height, maxEdge);
  }
  if (size) ctx = ctx.resize(size);
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ base64: true, format: SaveFormat.JPEG, compress: quality });
  // The canvas copy also comes back as a blob: URL — only the data URL is used.
  if (/^blob:/.test(out.uri)) {
    try {
      URL.revokeObjectURL(out.uri);
    } catch {
      /* tidy-up only */
    }
  }
  return out.base64 ? `data:image/jpeg;base64,${out.base64}` : null;
}

export async function chooseScreenshot(): Promise<Shot> {
  let r: ImagePicker.ImagePickerResult;
  try {
    // Must run straight from the tap — browsers only open a file picker on a user gesture.
    r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1, base64: false });
  } catch {
    return { kind: "error", message: "Couldn't open your pictures. Try again." };
  }
  const a = r.canceled ? null : r.assets?.[0];
  if (!a?.uri) return { kind: "canceled" };
  try {
    let url = await encode(a.uri, a.width, a.height, MAX_EDGE_PX, JPEG_QUALITY);
    if (url && url.length > MAX_DATA_URL_CHARS) url = await encode(a.uri, a.width, a.height, 1200, 0.45);
    if (!url) return { kind: "error", message: "Couldn't read that picture — choose it again." };
    if (url.length > MAX_DATA_URL_CHARS) return { kind: "error", message: "Too big — choose the screenshot itself." };
    return { kind: "ok", dataUrl: url };
  } catch {
    return { kind: "error", message: "Couldn't read that picture — choose it again." };
  }
}
