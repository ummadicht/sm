// Open GradeIQ's camera page (/v2/cam/<id>) on THIS device, in Chrome.
//
// Not the in-app WebView: it has no camera grant (screens/Web.tsx) and the
// torch-lit photos only work in Chrome on Android. Chrome registers the
// `googlechrome://navigate?url=` scheme on Android, so we ask for Chrome by name
// first; a phone without Chrome falls back to the default browser (the camera
// page still works there, minus the torch). Browser twin: ./openCamera.web.ts.
import { Linking, Platform } from "react-native";

export type OpenResult = { ok: true; inChrome: boolean } | { ok: false; error: string };

/** Plain hand-off to whatever browser the device uses — the fallback when Chrome didn't show the page. */
export async function openInDefaultBrowser(url: string): Promise<OpenResult> {
  try {
    await Linking.openURL(url);
    return { ok: true, inChrome: false };
  } catch (e) {
    return { ok: false, error: `Couldn't open a browser${e instanceof Error && e.message ? ` (${e.message})` : ""}.` };
  }
}

export async function openCameraPage(url: string): Promise<OpenResult> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Bad camera link — ask your manager." };
  if (Platform.OS === "android") {
    try {
      // The URL goes in AS IS, not encoded: Chrome takes everything after "url="
      // literally, so an encoded "https%3A%2F%2F…" opened a broken address
      // instead of the camera page (found on a real tablet, 2026-10-17).
      await Linking.openURL(`googlechrome://navigate?url=${url}`);
      return { ok: true, inChrome: true };
    } catch {
      /* no Chrome — try the default browser */
    }
  }
  try {
    await Linking.openURL(url);
    return { ok: true, inChrome: false };
  } catch (e) {
    return { ok: false, error: `Couldn't open a browser${e instanceof Error && e.message ? ` (${e.message})` : ""} — install Chrome.` };
  }
}
