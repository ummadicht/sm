// Open GradeIQ's camera page (/v2/cam/<id>) on THIS device, in Chrome.
//
// Not the in-app WebView: it has no camera grant (screens/Web.tsx) and the
// torch-lit photos only work in Chrome on Android. Chrome registers the
// `googlechrome://navigate?url=` scheme on Android, so we ask for Chrome by name
// first; a phone without Chrome falls back to the default browser (the camera
// page still works there, minus the torch). Browser twin: ./openCamera.web.ts.
import { Linking, Platform } from "react-native";

export type OpenResult = { ok: true; inChrome: boolean } | { ok: false; error: string };

export async function openCameraPage(url: string): Promise<OpenResult> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "The camera link from the server isn't a web address. Ask your manager to check the GradeIQ settings." };
  if (Platform.OS === "android") {
    try {
      await Linking.openURL(`googlechrome://navigate?url=${encodeURIComponent(url)}`);
      return { ok: true, inChrome: true };
    } catch {
      /* no Chrome — try the default browser */
    }
  }
  try {
    await Linking.openURL(url);
    return { ok: true, inChrome: false };
  } catch (e) {
    return { ok: false, error: `This tablet couldn't open a browser${e instanceof Error && e.message ? ` (${e.message})` : ""}. Install or enable Chrome and try again.` };
  }
}
