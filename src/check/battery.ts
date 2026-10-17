// Pure logic of the battery-health step (swapup docs/PHONE-LED-FLOW.md §4):
// where the customer finds the battery-health screen on their phone, how big the
// screenshot may be when it goes to the store, and what the store's answer
// means. No runtime imports — node --test runs it.
//
// The store's server forwards the screenshot to GradeIQ's /ocr, which reads the
// health %; below 80 % it becomes the "battery drain" fault. The phone never
// decides that — it only shows what was read.

export type BatteryPlatform = "samsung" | "pixel" | "android" | "ios";

export type BatteryGuide = {
  platform: BatteryPlatform;
  /** Where the health % is, as a Settings path. */
  path: string;
  /** A second place to look, when the first is missing on older software. */
  alt: string | null;
  /** How to take a screenshot on this phone. */
  screenshot: string;
  /** Android Settings page to open (falls back to Settings itself). null = no button (iPhone, browser). */
  settingsAction: string | null;
};

/**
 * Per platform, from what the phone said about itself and what the store
 * matched. Samsung is the common case at a Samsung service centre; One UI shows
 * the health under Battery information, and older versions only in Samsung
 * Members' diagnostics. Pixel 8 and later show it in Settings. Other Android
 * phones differ by maker, so only the Battery page is named. iPhones (browser
 * only) have Battery Health & Charging. No dial codes: they differ by phone,
 * and a wrong one is a dead end at the counter.
 */
export function batteryGuide(p: { brand?: string | null; label?: string | null; modelCode?: string | null; ios?: boolean }): BatteryGuide {
  const s = [p.brand, p.label, p.modelCode].filter(Boolean).join(" ").toLowerCase();
  if (p.ios || /\b(apple|iphone|ipad)\b/.test(s))
    return {
      platform: "ios",
      path: "Settings › Battery › Battery Health & Charging (Maximum Capacity)",
      alt: null,
      screenshot: "Press the side button and volume up together.",
      settingsAction: null,
    };
  if (/samsung|galaxy/.test(s) || /^sm-/i.test(p.modelCode ?? ""))
    return {
      platform: "samsung",
      path: "Settings › Battery › Battery information",
      alt: "Not there? Samsung Members › Diagnostics › Battery status.",
      screenshot: "Press the power and volume down buttons together.",
      settingsAction: "android.intent.action.POWER_USAGE_SUMMARY",
    };
  if (/pixel|google/.test(s))
    return {
      platform: "pixel",
      path: "Settings › Battery › Battery health",
      alt: null,
      screenshot: "Press the power and volume down buttons together.",
      settingsAction: "android.intent.action.POWER_USAGE_SUMMARY",
    };
  return {
    platform: "android",
    path: "Settings › Battery (look for Battery health or Battery information)",
    alt: null,
    screenshot: "Press the power and volume down buttons together.",
    settingsAction: "android.intent.action.POWER_USAGE_SUMMARY",
  };
}

/** The longest side of the picture sent — plenty for the OCR to read a %, and small on store Wi‑Fi. */
export const MAX_EDGE_PX = 1600;
export const JPEG_QUALITY = 0.6;
/** The server takes a data URL of up to 3 MB. */
export const MAX_DATA_URL_CHARS = 3_000_000;

/** The resize that brings a w×h picture within `max` on its longest side (aspect kept), or null when it already fits / the size is unknown. */
export function fitWithin(w: number, h: number, max: number = MAX_EDGE_PX): { width: number } | { height: number } | null {
  if (!(w > 0) || !(h > 0) || Math.max(w, h) <= max) return null;
  return w >= h ? { width: max } : { height: max };
}

export type BatteryAnswer = { healthPct: number | null; outcome: string };

/** POST /api/device/battery → { healthPct | null, outcome }. null = not that shape. A % outside 1–100 is not a reading. */
export function readBatteryAnswer(raw: unknown): BatteryAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!("healthPct" in r) && !("outcome" in r)) return null;
  const pctOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100 ? Math.round(v) : null);
  // The check's RECORDED reading wins when the server sends one: an unreadable
  // screenshot keeps an earlier reading there, and the store prices from that.
  const rec = r.recorded && typeof r.recorded === "object" ? (r.recorded as Record<string, unknown>) : null;
  const recPct = rec ? pctOf(rec.healthPct) : null;
  if (recPct != null) return { healthPct: recPct, outcome: typeof rec!.outcome === "string" ? (rec!.outcome as string) : "pass" };
  const n = pctOf(r.healthPct);
  return { healthPct: n, outcome: typeof r.outcome === "string" ? r.outcome : n == null ? "skip" : "pass" };
}

/** The Result screen's "Battery health" value. */
export function batteryResultText(rec: { outcome: string; healthPct: number | null } | null | undefined): string {
  if (rec?.outcome === "read" && rec.healthPct != null) return `${rec.healthPct} %`;
  if (rec?.outcome === "unreadable") return "couldn't be read";
  return "not checked";
}
