// Pure logic of the pairing screen (docs/AUTO-TESTS.md "Order" step 2): the
// customer's phone lies on the counter, screen up, and shows whatever pattern
// GradeIQ's camera page (on the STORE device) asks for, echoing what it shows.
// Mirrors GradeIQ's own primary-phone loop (giq/app/components/V2Flow.tsx
// 236-275 and 794-808): poll ~700 ms, leave on handoffDone, or 30 s after
// cosmeticDone when the camera never says it is finished.
//
// Contract: SwapUp's ticket-authenticated GET/POST /api/device/screen, a proxy
// of GradeIQ's /api/sessions/{id}/screen ({pattern, shown, cosmeticDone,
// handoffDone, capture, connectedAt}). No runtime imports — node --test runs it.

/** Solid fills, exactly GradeIQ V2Flow's FILLS. "stripes" is drawn separately; anything else is "idle". */
export const PATTERN_FILLS: Readonly<Record<string, string>> = {
  white: "#ffffff",
  gray: "#808080",
  black: "#000000",
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
};
/** GradeIQ's stripes: repeating-linear-gradient(90deg, #000 0 6px, #fff 6px 12px) — 6 px vertical bands. */
export const STRIPE_PX = 6;

export const POLL_MS = 700;
export const GRACE_AFTER_COSMETIC_MS = 30_000;
/** "Continue without photos" appears when the store's camera has not connected in this long. */
export const NO_CONNECT_MS = 180_000;
/**
 * Safety net beyond the design doc: once connected, if nothing at all changes
 * for this long (camera page closed mid-way), the same button appears so the
 * customer is never trapped on this screen. Long enough not to show up while
 * the advisor is still taking the manual photos.
 */
export const STALL_MS = 360_000;
/** Consecutive refusals (4xx other than auth) before the camera check is treated as unavailable. */
export const UNAVAILABLE_AFTER = 3;

/** What this phone can actually draw for a requested pattern — and so what it echoes as `shown`. */
export function displayablePattern(p: unknown): string {
  if (typeof p !== "string") return "idle";
  const k = p.trim().toLowerCase();
  if (k === "stripes" || Object.prototype.hasOwnProperty.call(PATTERN_FILLS, k)) return k;
  return "idle";
}

export type ScreenPoll = {
  pattern: string;
  shown: string | null;
  cosmeticDone: boolean;
  handoffDone: boolean;
  connectedAt: string | null;
  capture: { verdict: string; reasons: string[] } | null;
};

/** Validate a GET /api/device/screen body. null = not the shape we expect. */
export function parseScreen(raw: unknown): ScreenPoll | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.pattern !== "string") return null;
  const cap = r.capture && typeof r.capture === "object" ? (r.capture as Record<string, unknown>) : null;
  return {
    pattern: r.pattern,
    shown: typeof r.shown === "string" ? r.shown : null,
    cosmeticDone: r.cosmeticDone === true,
    handoffDone: r.handoffDone === true,
    connectedAt: typeof r.connectedAt === "string" && r.connectedAt ? r.connectedAt : null,
    capture:
      cap && typeof cap.verdict === "string"
        ? { verdict: cap.verdict, reasons: Array.isArray(cap.reasons) ? cap.reasons.filter((x): x is string => typeof x === "string") : [] }
        : null,
  };
}

export type Tracker = {
  startedAt: number;
  /** When this phone first saw evidence of the store's camera (connectedAt, a pattern, a capture verdict…). */
  connectedAt: number | null;
  cosmeticSince: number | null;
  /** Last time anything in the screen state changed. */
  lastChangeAt: number;
  lastSig: string;
  refusals: number;
  lastPollOkAt: number | null;
};

export function newTracker(now: number): Tracker {
  return { startedAt: now, connectedAt: null, cosmeticSince: null, lastChangeAt: now, lastSig: "", refusals: 0, lastPollOkAt: null };
}

export type Leave = "handoff" | "grace";

/** Fold one successful poll into the tracker; says when to leave the pairing screen. */
export function trackPoll(tr: Tracker, poll: ScreenPoll, now: number): { tracker: Tracker; leave: Leave | null } {
  const connected =
    !!poll.connectedAt || displayablePattern(poll.pattern) !== "idle" || poll.cosmeticDone || poll.handoffDone || !!poll.capture;
  const sig = [poll.pattern, poll.cosmeticDone, poll.handoffDone, poll.connectedAt, poll.capture?.verdict ?? ""].join("|");
  const next: Tracker = {
    ...tr,
    connectedAt: tr.connectedAt ?? (connected ? now : null),
    lastChangeAt: sig !== tr.lastSig ? now : tr.lastChangeAt,
    lastSig: sig,
    refusals: 0,
    lastPollOkAt: now,
    cosmeticSince: poll.cosmeticDone ? tr.cosmeticSince ?? now : null,
  };
  if (poll.handoffDone) return { tracker: next, leave: "handoff" };
  if (next.cosmeticSince != null && now - next.cosmeticSince >= GRACE_AFTER_COSMETIC_MS) return { tracker: next, leave: "grace" };
  return { tracker: next, leave: null };
}

/** A refused poll (4xx that is not about the ticket). After a few in a row the camera check is unavailable. */
export function trackRefusal(tr: Tracker): { tracker: Tracker; unavailable: boolean } {
  const refusals = tr.refusals + 1;
  return { tracker: { ...tr, refusals }, unavailable: refusals >= UNAVAILABLE_AFTER };
}

/** Why "Continue without photos" is offered right now, or null if it isn't. */
export function skipOffer(tr: Tracker, now: number): "never-connected" | "stalled" | null {
  if (tr.connectedAt == null) return now - tr.startedAt >= NO_CONNECT_MS ? "never-connected" : null;
  return now - tr.lastChangeAt >= STALL_MS ? "stalled" : null;
}

/** The echo needs re-sending when the server's `shown` isn't what this screen is drawing (a lost POST). */
export function needsEcho(poll: ScreenPoll | null, drawing: string): boolean {
  return !poll || poll.shown !== drawing;
}
