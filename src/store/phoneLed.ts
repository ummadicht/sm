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

/** Where the customer's phone says it is (POST /api/device/phase). */
export type PhonePhase = "identify" | "scan" | "battery" | "test" | "done";
const PHASES: readonly string[] = ["identify", "scan", "battery", "test", "done"];

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
  /** The phone moved past its Scan step without the camera (“Skip the camera check”, or it gave up waiting). */
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
    i.status === "complete" ||
    i.status === "applied" ||
    (i.phase === null && i.status === "testing");
  if (past) return i.photosDone ? "done" : "skipped";
  if (i.grading === "pending") return "setup";
  return i.phase === "scan" || i.deviceReady ? "now" : "waiting";
}

/** The session stepper for the phone-led flow: Join · Identify · Scan · Test · Result. Index of the step reached; 4 = all done. */
export const SCAN_FIRST_STEPS = ["Join", "Identify", "Scan", "Test", "Result"] as const;

export function scanFirstReached(status: string, phase: PhonePhase | null, joined: boolean): number {
  if (status === "complete" || status === "applied") return 4;
  if (status === "waiting" || status === "opened") return 0;
  switch (phase) {
    case "done":
      return 4;
    case "battery":
    case "test":
      return 3;
    case "scan":
      return 2;
    case "identify":
      return 1;
    default:
      return status === "testing" ? 3 : joined || status === "joined" ? 1 : 0;
  }
}

/** The big line at the top of the session for the phone-led flow. null = the ordinary nowLine says it better. */
export function scanFirstNow(
  v: { status: string; progress?: { done: number; total: number } | null },
  phase: PhonePhase | null,
  stage: ScanStage
): { text: string; tone: Tone } | null {
  const done = v.progress?.done ?? 0;
  const total = v.progress?.total ?? 0;
  const grading = stage === "off" ? "" : " The camera grade is being worked out meanwhile.";
  switch (v.status) {
    case "waiting":
      return { text: "Turn the tablet to the customer: they scan the test code (step 1) and their phone takes it from there.", tone: "muted" };
    case "joined":
    case "testing":
      break;
    case "complete":
      return { text: "The customer's phone has finished. Check the summary, then apply it to the case.", tone: "up" };
    default:
      return null;
  }
  if (stage === "now") return { text: "The customer's phone is showing its scan code. Scan it with this tablet's camera app — or tap Take photos (step 3).", tone: "fix" };
  if (phase === "identify" || (!phase && v.status === "joined"))
    return { text: "The customer's phone is identifying itself — model and IMEI (step 2). Next it shows a code for you to scan.", tone: "fix" };
  if (phase === "battery") return { text: `The customer is reading their battery health.${grading}`, tone: "fix" };
  if (phase === "done") return { text: "The customer's phone has finished its checks.", tone: "up" };
  return {
    text: `Testing itself${total ? ` — ${done} of ${total} done` : ""}.${stage === "skipped" ? " It wasn't scanned, so check the screen and condition by eye." : grading}`,
    tone: "fix",
  };
}

// ── what the customer told their phone (step 2) ──────────────────────────────

export type Picked = { modelId: string; variant: string | null; label: string | null };

export type Identity = {
  imei: string | null;
  imei2: string | null;
  /** "Yes, that's my phone" = true, "No — choose my phone" = false, not asked or not answered = null. */
  identityConfirmed: boolean | null;
  /** The model the customer chose in the picker — a CLAIM, never a match. */
  picked: Picked | null;
  /** Typed on the phone in a customer-started trade-in (the counter QR). */
  customerName: string | null;
  customerPhone: string | null;
};

/** session.declared → the identity part. Anything missing or unreadable is null — never guessed. */
export function readIdentity(declared: unknown): Identity {
  const d = obj(declared);
  const p = obj(d?.picked);
  const modelId = str(p?.modelId) ?? str(p?.id);
  return {
    imei: str(d?.imei),
    imei2: str(d?.imei2),
    identityConfirmed: bool(d?.identityConfirmed),
    picked: p && modelId ? { modelId, variant: str(p.variant), label: str(p.label) ?? str(p.name) } : null,
    customerName: str(d?.customerName),
    customerPhone: str(d?.customerPhone),
  };
}

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

/**
 * The IMEI(s) the customer typed against the one(s) already on the case. A dual-SIM
 * phone has two, typed in either order, so it is a mismatch only when they share no
 * number at all. null = nothing to compare yet, or they agree.
 */
export function imeiMismatch(id: Identity, recorded: { imei: string | null; imei2: string | null } | null): { recorded: string[] } | null {
  const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
  const typed = [digits(id.imei), digits(id.imei2)].filter(Boolean);
  const onCase = recorded ? [digits(recorded.imei), digits(recorded.imei2)].filter(Boolean) : [];
  if (!typed.length || !onCase.length) return null;
  return typed.some((x) => onCase.includes(x)) ? null : { recorded: onCase };
}

/**
 * The server's own verdict on the typed IMEI(s) against the case's (staff view
 * `imeiAgreement`, same rule as imeiMismatch). null = an older server: compare here.
 */
export function readImeiAgreement(raw: unknown): "match" | "differs" | "unknown" | null {
  const a = str(obj(raw)?.imeiAgreement);
  return a === "match" || a === "differs" || a === "unknown" ? a : null;
}

/** The customer started this trade-in alone, from the store's counter QR (staff view `customerStarted`). */
export const customerStarted = (raw: unknown): boolean => obj(raw)?.customerStarted === true;

/** GET /api/cases/<id> → the IMEIs recorded on the case. null = not a case answer. */
export function readCaseImeis(raw: unknown): { imei: string | null; imei2: string | null } | null {
  const o = obj(raw);
  const c = obj(o?.case) ?? o;
  if (!c || !("imei" in c)) return null;
  return { imei: str(c.imei), imei2: str(c.imei2) };
}

/** GET /api/catalog/models → { id: "Samsung Galaxy A54" } — names for a picked model id. */
export function modelLabels(raw: unknown): Record<string, string> {
  const o = obj(raw);
  const list = Array.isArray(o?.models) ? o.models : Array.isArray(raw) ? raw : [];
  const out: Record<string, string> = {};
  for (const x of list) {
    const m = obj(x);
    const id = str(m?.id);
    const label = [str(m?.brand), str(m?.model)].filter(Boolean).join(" ") || str(m?.label);
    if (id && label) out[id] = label;
  }
  return out;
}

/** "Customer says …" — what they answered on "Is this your phone?". `asking`: the phone is on that question now. */
export function customerSays(id: Identity, pickedLabel: string | null, asking: boolean): { text: string; tone: Tone } {
  const chosen = id.picked ? [pickedLabel ?? id.picked.label ?? id.picked.modelId, id.picked.variant].filter(Boolean).join(" · ") : null;
  if (chosen)
    return {
      text: id.identityConfirmed === false ? `Not the model shown — they picked ${chosen}` : `They picked ${chosen}`,
      tone: "warn",
    };
  if (id.identityConfirmed === true) return { text: "“Yes, that's my phone”", tone: "up" };
  if (id.identityConfirmed === false) return { text: "“Not my phone” — they left the model to you", tone: "warn" };
  return { text: asking ? "Not answered yet" : "Not answered", tone: "muted" };
}

// ── battery health (a test result) ───────────────────────────────────────────

export type BatteryHealth = {
  pct: number | null;
  outcome: string;
  method: string | null;
  /** Earlier readings this one replaced (the server keeps the last few) — a seller who tried several screenshots. */
  earlier: number[];
};

const readPct = (x: unknown): number | null => {
  const n = num(x);
  return n !== null && n > 0 && n <= 100 ? Math.round(n) : null;
};

/** results.battery_health → { pct, outcome, method, earlier }. null = the phone hasn't sent it (or its plan has no such step). */
export function batteryHealth(results: unknown): BatteryHealth | null {
  const r = obj(obj(results)?.battery_health);
  if (!r) return null;
  const d = obj(r.detail);
  const earlier = (Array.isArray(d?.earlier) ? d.earlier : []).map(readPct).filter((x): x is number => x !== null);
  return { pct: readPct(d?.healthPct), outcome: str(r.outcome) ?? "skip", method: str(d?.method), earlier };
}

/** Below this the server records the battery_drain fault. */
export const BATTERY_HEALTH_MIN = 80;

export function batteryLine(b: BatteryHealth): { text: string; tone: Tone } {
  if (b.pct === null) return { text: "Not read — skipped, or the screenshot was unclear", tone: "muted" };
  const tried = b.earlier.length ? ` (earlier screenshot${b.earlier.length > 1 ? "s" : ""}: ${b.earlier.map((x) => `${x}%`).join(", ")})` : "";
  return b.pct >= BATTERY_HEALTH_MIN
    ? { text: `${b.pct}%${tried}`, tone: b.earlier.length ? "warn" : "up" }
    : { text: `${b.pct}% — below ${BATTERY_HEALTH_MIN}%${tried}`, tone: "bad" };
}

// ── Home ─────────────────────────────────────────────────────────────────────

/** The chip on an open test in Home's list for the phone-led flow: the advisor is needed to scan. */
export function scanFlag(stage: ScanStage): { text: string; tone: Tone } | null {
  return stage === "now" ? { text: "Ready to scan", tone: "fix" } : null;
}

// ── the counter QR (Settings) ────────────────────────────────────────────────

/** GET /api/stores/counter-code → { code, joinUrl }. joinUrl may be relative (the caller makes it absolute). */
export function readCounterCode(raw: unknown): { code: string; joinUrl: string | null } | null {
  const o = obj(raw);
  const code = str(o?.code) ?? str(obj(o?.counter)?.code);
  if (!code) return null;
  return { code: code.toUpperCase(), joinUrl: str(o?.joinUrl) ?? str(obj(o?.counter)?.joinUrl) };
}
