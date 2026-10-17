// Browser twin of ./openCamera.ts: GradeIQ's camera page opens in a NEW tab, so
// this tab keeps the live trade-in (and its 2 s poll) exactly where it was.
// Called straight from the button's tap, so popup blockers allow it.
export type OpenResult = { ok: true; inChrome: boolean } | { ok: false; error: string };

const CAMERA_TAB = "swapup-camera";

export async function openCameraPage(url: string): Promise<OpenResult> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "The camera link from the server isn't a web address. Ask your manager to check the GradeIQ settings." };
  try {
    const w = window.open(url, CAMERA_TAB);
    if (!w) return { ok: false, error: "The browser blocked the new tab. Allow pop-ups for this site, then tap “Take photos” again." };
    try {
      // GradeIQ's page has no business with this one.
      w.opener = null;
      w.focus();
    } catch {
      /* cross-origin or refused focus — the tab is open anyway */
    }
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const chrome = /Chrome\//.test(ua) && !/(Edg|OPR|SamsungBrowser)\//.test(ua);
    return { ok: true, inChrome: chrome };
  } catch (e) {
    return { ok: false, error: `The browser refused to open the camera page${e instanceof Error && e.message ? ` (${e.message})` : ""}.` };
  }
}

/** Same page, same tab name — the browser build has no Chrome-vs-default distinction. */
export const openInDefaultBrowser = openCameraPage;
