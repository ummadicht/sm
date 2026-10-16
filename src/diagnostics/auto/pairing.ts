// Pure logic of the pairing screen (docs/AUTO-TESTS.md "Order" step 2): the
// customer's phone lies on the counter, screen up, and shows whatever pattern
// GradeIQ's camera page (on the STORE device) asks for, echoing what it shows.
// Mirrors GradeIQ's own primary-phone loop (giq/app/components/V2Flow.tsx
// 236-275 and 794-808): poll ~700 ms, leave on handoffDone, or 30 s after
// cosmeticDone when the camera never says it is finished.
//
// Contract: SwapUp's ticket-authenticated GET/POST /api/device/screen
// (swapup docs/MOBILE-API.md §4 "Photo check"), a proxy of GradeIQ's
// /api/sessions/{id}/screen: { state, pattern, shown, cosmeticDone, handoffDone,
// capture }. state disabled/failed → no photo check, run the tests; pending →
// wait; ready → show the pattern. 503 → keep polling. GradeIQ's `connectedAt`
// is not relayed, so "the store's camera is there" = it asked for a pattern or
// judged a capture. No runtime imports — node --test runs it.

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
/**
 * The camera check is treated as unavailable only when the server has refused
 * (4xx other than auth) every poll for this long — a check whose GradeIQ
 * session is still being created must not be written off after two seconds.
 */
export const UNAVAILABLE_AFTER_MS = 15_000;
export const UNAVAILABLE_MIN_REFUSALS = 3;

/** What this phone can actually draw for a requested pattern — and so what it echoes as `shown`. */
export function displayablePattern(p: unknown): string {
  if (typeof p !== "string") return "idle";
  const k = p.trim().toLowerCase();
  if (k === "stripes" || Object.prototype.hasOwnProperty.call(PATTERN_FILLS, k)) return k;
  return "idle";
}

export type ScreenPoll = {
  /** SwapUp's GradeIQ state for this check; null when the server doesn't say (treated as ready). */
  state: string | null;
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
    state: typeof r.state === "string" ? r.state : null,
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
  refusingSince: number | null;
  lastPollOkAt: number | null;
};

export function newTracker(now: number): Tracker {
  return { startedAt: now, connectedAt: null, cosmeticSince: null, lastChangeAt: now, lastSig: "", refusals: 0, refusingSince: null, lastPollOkAt: null };
}

/** handoff / grace: the photos are done. disabled / failed: no camera grading for this check — run the tests. */
export type Leave = "handoff" | "grace" | "disabled" | "failed";

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
    refusingSince: null,
    lastPollOkAt: now,
    cosmeticSince: poll.cosmeticDone ? tr.cosmeticSince ?? now : null,
  };
  if (poll.state === "disabled" || poll.state === "failed") return { tracker: next, leave: poll.state };
  if (poll.handoffDone) return { tracker: next, leave: "handoff" };
  if (next.cosmeticSince != null && now - next.cosmeticSince >= GRACE_AFTER_COSMETIC_MS) return { tracker: next, leave: "grace" };
  return { tracker: next, leave: null };
}

/** A refused poll (4xx that is not about the ticket). Refused for long enough → the camera check is unavailable. */
export function trackRefusal(tr: Tracker, now: number): { tracker: Tracker; unavailable: boolean } {
  const refusals = tr.refusals + 1;
  const refusingSince = tr.refusingSince ?? now;
  return {
    tracker: { ...tr, refusals, refusingSince },
    unavailable: refusals >= UNAVAILABLE_MIN_REFUSALS && now - refusingSince >= UNAVAILABLE_AFTER_MS,
  };
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
