// The phone-led flow (docs/PHONE-LED-FLOW.md in the server repo, 2026-10-17) as
// the store app reads it. SwapUp Check 0.6.0+ leads the trade-in: the customer's
// phone identifies itself (model, IMEI), shows GradeIQ's camera link as a QR for
// this tablet to scan, reads its battery health, then tests itself. The tablet's
// job becomes: scan, watch, apply, price.
//
// Which layout a session gets — the server is the judge, the app only reads it:
//   - scanFirst: a server that knows the phone-led flow (it sends `phonePhase`,
//     even as null) and a phone that leads (it has posted a phase, the server says
//     `scanFirst`, or it is Check 0.6.0+), with no photos-first link
//     (`photosUrl: null` — the server stops offering it once such a phone joins). Before any phone has
//     joined we can't know which app the customer has; such a server hands out
//     0.6.0+, so the phone-led order shows, and an older app that joins flips the
//     screen back to photos-first (its photos can still be taken while it tests).
//   - twoPass / onePass: everything older, exactly as before (./grading.ts).
//
// No runtime imports — node --test runs it (./phoneLed.test.ts).
import type { Tone } from "./ui";

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const bool = (x: unknown): boolean | null => (typeof x === "boolean" ? x : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

// ── which flow ───────────────────────────────────────────────────────────────

/**
 * Where the customer's phone says it is (POST /api/device/phase). "colours": on its result
 * screen, showing the test colours for the advisor's check by eye ("Check the phone").
 */
export type PhonePhase = "identify" | "scan" | "battery" | "test" | "done" | "colours";
const PHASES: readonly string[] = ["identify", "scan", "battery", "test", "done", "colours"];

export type PhaseInfo = {
  /** The server knows the phone-led flow: it sends the key, even as null. */
  known: boolean;
  phase: PhonePhase | null;
  at: string | null;
};

export function readPhonePhase(raw: unknown): PhaseInfo {
  const v = obj(raw);
  const g = obj(v?.grading);
  const known = !!v && ("phonePhase" in v || (!!g && "phonePhase" in g));
  const p = str(v?.phonePhase) ?? str(g?.phonePhase);
  return { known, phase: p && PHASES.includes(p) ? (p as PhonePhase) : null, at: str(v?.phonePhaseAt) ?? str(g?.phonePhaseAt) };
}

/** SwapUp Check 0.6.0+ — the app ("0.6.0") or the browser check ("web-0.6.0"). Same rule as the server's scanFirstApp. */
export function scanFirstApp(appVersion: string | null | undefined): boolean {
  const m = /^(?:web-)?(\d+)\.(\d+)\.(\d+)/.exec(appVersion ?? "");
  if (!m) return false;
  return Number(m[1]) > 0 || Number(m[2]) >= 6;
}

export type Layout = "scanFirst" | "twoPass" | "onePass";

/** `g` is readGrading(raw): only twoPass and photosUrl are read. */
export function sessionLayout(raw: unknown, g: { twoPass: boolean; photosUrl: string | null }): Layout {
  const v = obj(raw);
  const p = readPhonePhase(raw);
  if (p.known) {
    const device = obj(v?.device);
    if (!device && !p.phase) return "scanFirst";
    const leads = !!p.phase || v?.scanFirst === true || scanFirstApp(str(device?.appVersion));
    if (leads && !g.photosUrl) return "scanFirst";
  }
  return g.twoPass ? "twoPass" : "onePass";
}

// ── the scan (step 3) ────────────────────────────────────────────────────────

export type ScanStage =
  /** No camera grading for this session (not set up, switched off, or failed). */
  | "off"
  /** The GradeIQ session is still being created. */
  | "setup"
  /** The phone hasn't reached its Scan step yet (not joined, or identifying itself). */
  | "waiting"
  /** The phone is on its Scan step, showing GradeIQ's camera link as a QR. */
  | "now"
  /** The camera has been: the screen check ran, or the photos are in and the phone moved on. */
  | "done"
  /** The phone moved past its Scan step without the camera (the advisor went on without it; an older phone's own skip). */
  | "skipped";

export function scanStage(i: {
  grading: "absent" | "disabled" | "failed" | "pending" | "ready";
  phase: PhonePhase | null;
  status: string;
  deviceReady: boolean;
  photosDone: boolean;
  screenDone: boolean;
}): ScanStage {
  if (i.grading === "absent" || i.grading === "disabled" || i.grading === "failed") return "off";
  if (i.screenDone) return "done";
  // Results only arrive after the scan in this flow, so a phone that is "testing"
  // without telling us its phase (an older server answer, a lost phase post) is past it too.
  const past =
    i.phase === "battery" ||
    i.phase === "test" ||
    i.phase === "done" ||
    i.phase === "colours" ||
    i.status === "complete" ||
    i.status === "applied" ||
    (i.phase === null && i.status === "testing");
  if (past) return i.photosDone ? "done" : "skipped";
  if (i.grading === "pending") return "setup";
  return i.phase === "scan" || i.deviceReady ? "now" : "waiting";
}

/** The big line at the top of the session for the phone-led flow. null = the ordinary nowLine says it better. */
export function scanFirstNow(
  v: { status: string; progress?: { done: number; total: number } | null },
  phase: PhonePhase | null,
  stage: ScanStage
): { text: string; tone: Tone } | null {
  const done = v.progress?.done ?? 0;
  const total = v.progress?.total ?? 0;
  const grading = stage === "off" ? "" : "; camera grade coming";
  switch (v.status) {
    case "waiting":
      return { text: "Customer scans the test code (step 2).", tone: "muted" };
    case "joined":
    case "testing":
      break;
    case "complete":
      return { text: "Tests done.", tone: "up" };
    default:
      return null;
  }
  if (stage === "now") return { text: "Scan the code on the phone — or tap Take photos (step 3).", tone: "fix" };
  if (phase === "identify" || (!phase && v.status === "joined"))
    return { text: "Confirming which phone it is — a code to scan comes next.", tone: "fix" };
  if (phase === "battery") return { text: `Reading battery health${grading}.`, tone: "fix" };
  if (phase === "done" || phase === "colours") return { text: "Tests done.", tone: "up" };
  return {
    text: `Testing${total ? ` — ${done} of ${total} done` : ""}${stage === "skipped" ? "; not scanned, check the phone at step 3" : grading}.`,
    tone: "fix",
  };
}

// ── the IMEI and who started it ──────────────────────────────────────────────

/** The IMEI check digit (Luhn over 15 digits). null = nothing to check. */
export function imeiCheck(raw: string | null | undefined): "ok" | "bad" | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length !== 15) return "bad";
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let n = d.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0 ? "ok" : "bad";
}

/** The customer started this trade-in alone, from the store's counter QR (staff view `customerStarted`). */
export const customerStarted = (raw: unknown): boolean => obj(raw)?.customerStarted === true;

// ── Home ─────────────────────────────────────────────────────────────────────

/** The chip on an open test in Home's list for the phone-led flow: the advisor is needed to scan. */
export function scanFlag(stage: ScanStage): { text: string; tone: Tone } | null {
  return stage === "now" ? { text: "Ready to scan", tone: "fix" } : null;
}

/**
 * The scan is behind the phone but its screen was NOT camera-checked: the sweep never ran
 * (it moved on, it was released), or it ran without a verdict (`lcdNotChecked`). The scan
 * card says so with its chip instead of a plain "Scanned", and the advisor certifies the
 * screen in that same step ("Check the phone").
 */
export function screenUnchecked(stage: ScanStage, g: { screenDone: boolean; lcdNotChecked: string | null }): boolean {
  if (stage === "skipped") return true;
  return stage === "done" && (!g.screenDone || !!g.lcdNotChecked);
}

// ── the counter QR (Settings) ────────────────────────────────────────────────

/** GET /api/stores/counter-code → { code, joinUrl }. joinUrl may be relative (the caller makes it absolute). */
export function readCounterCode(raw: unknown): { code: string; joinUrl: string | null } | null {
  const o = obj(raw);
  const code = str(o?.code) ?? str(obj(o?.counter)?.code);
  if (!code) return null;
  return { code: code.toUpperCase(), joinUrl: str(o?.joinUrl) ?? str(obj(o?.counter)?.joinUrl) };
}
