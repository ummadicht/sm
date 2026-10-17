// Pure logic of the Scan screen — the FIRST step after Identify since the
// phone-led flow (swapup docs/PHONE-LED-FLOW.md, app ≥ 0.6.0): the customer's
// phone shows a QR of GradeIQ's camera link; the advisor's tablet scans it and
// opens GradeIQ's camera page, which photographs this phone, then asks it to
// show patterns for the screen sweep (and may ask for a photo of Settings), and
// this phone echoes what it shows. Mirrors GradeIQ's own primary-phone loop
// (giq/app/components/V2Flow.tsx 236-275 and 794-808): poll ~700 ms, leave on
// handoffDone, or 30 s after cosmeticDone when the camera never says it is
// finished.
//
// A store app that photographs the phone before it joins (swapup
// docs/TWO-PASS-CAMERA.md, still served to older flows) can leave cosmeticDone
// and a capture verdict on /screen before this screen mounts. They are
// baselined like connectedAt: only ones that appear or change after mount count.
//
// Contract: SwapUp's ticket-authenticated GET/POST /api/device/screen
// (swapup docs/MOBILE-API.md §4 "Photo check"), a proxy of GradeIQ's
// /api/sessions/{id}/screen: { state, pattern, shown, cosmeticDone, handoffDone,
// capture, connectedAt }. state disabled/failed → no camera check, move on;
// pending → wait; ready → show the pattern. 503 → keep polling. "The store's
// camera is there" = a NEW connectedAt (a camera page loaded after this screen
// mounted), or it asked for a pattern, or judged a capture. The QR itself comes
// from GET /api/device/camera-link → { url } (409 until GradeIQ is ready).
// No runtime imports — node --test runs it.

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
/**
 * "Skip the camera check" appears when the store's camera page has not opened in
 * this long. The store's camera only unlocks when this screen first echoes (and
 * the QR only shows here), so the clock and the advisor start together; the
 * advisor then has to scan the QR or tap Take photos — the camera page counts as
 * connected the moment it loads (SwapUp relays GradeIQ's connectedAt), not only
 * when it asks for a pattern. A cosmeticDone already there at mount does not
 * count. Once connected, only STALL_MS applies.
 */
export const NO_CONNECT_MS = 90_000;
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
  /**
   * GradeIQ's connectedAt as first seen on this screen. GradeIQ stamps it each time
   * a camera page loads and never clears it, so an OLD value (a camera opened
   * earlier, e.g. by an override during the tests) proves nothing; a NEW value does.
   * undefined = no poll yet.
   */
  firstConnectedAt?: string | null;
  /**
   * cosmeticDone as first seen on this screen, kept only while it stays set. The
   * photos are now taken before the phone joins, so a cosmeticDone already there
   * at mount is pass 1's — it must neither count as "the camera is here" nor start
   * the 30 s grace (that would walk off this screen before the screen check ran).
   * Once it clears (a retake), a later cosmeticDone is new. undefined = no poll yet.
   */
  staleCosmeticDone?: boolean;
  /** The capture verdict (+ reasons) as first seen on this screen, dropped once it changes — same reason. null = none at mount. */
  staleCapture?: string | null;
  /** When this phone first saw evidence of the store's camera (connectedAt, a pattern, a capture verdict…). */
  connectedAt: number | null;
  cosmeticSince: number | null;
  /**
   * The camera has driven a colour on THIS screen since it mounted. The 30 s
   * grace after cosmeticDone (GradeIQ's single pass, which never says handoff)
   * only applies then: a photos-only pass 1 that merely FINISHES after this
   * screen mounted never drives a pattern, and must not walk the phone off
   * before the screen check (pass 2) has run.
   */
  sawPattern?: boolean;
  /**
   * The camera has run its SCREEN SWEEP on this screen: it drew a colour only the
   * sweep uses (stripes, red, green, blue). White and black don't count — GradeIQ's
   * single pass also shows white when the photos start and black for the front-glass
   * shot, then idles through the back and sides. Only after the sweep does an idle
   * screen mean "now photograph Settings".
   */
  sawSweep?: boolean;
  /** Since when the camera has asked for "idle" (nothing drawn); null while a pattern is up. */
  idleSince?: number | null;
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

/** handoff / grace: the camera is done with this phone. disabled / failed: no camera grading for this check — go to Done. */
export type Leave = "handoff" | "grace" | "disabled" | "failed";

const captureSig = (poll: ScreenPoll): string | null => (poll.capture ? [poll.capture.verdict, ...poll.capture.reasons].join("|") : null);

/** cosmeticDone / capture that are news from a camera here NOW — not pass 1's leftovers from before this screen mounted. */
export function freshNews(tr: Tracker, poll: ScreenPoll): { cosmeticDone: boolean; capture: ScreenPoll["capture"] } {
  return {
    cosmeticDone: poll.cosmeticDone && !tr.staleCosmeticDone,
    capture: poll.capture && tr.staleCapture == null ? poll.capture : null,
  };
}

/** Fold one successful poll into the tracker; says when to leave the pairing screen. */
export function trackPoll(tr: Tracker, poll: ScreenPoll, now: number): { tracker: Tracker; leave: Leave | null } {
  const first = tr.firstConnectedAt === undefined;
  const firstConnectedAt = first ? poll.connectedAt : tr.firstConnectedAt;
  const freshCameraPage = !!poll.connectedAt && poll.connectedAt !== firstConnectedAt;
  // Baselines: set by the first poll, dropped for good the moment the value changes.
  const capSig = captureSig(poll);
  const staleCosmeticDone = first ? poll.cosmeticDone : !!tr.staleCosmeticDone && poll.cosmeticDone;
  const staleCapture = first ? capSig : tr.staleCapture != null && tr.staleCapture === capSig ? tr.staleCapture : null;
  const news = freshNews({ ...tr, staleCosmeticDone, staleCapture }, poll);
  const connected =
    freshCameraPage || displayablePattern(poll.pattern) !== "idle" || news.cosmeticDone || poll.handoffDone || !!news.capture;
  const sig = [poll.pattern, poll.cosmeticDone, poll.handoffDone, poll.connectedAt, poll.capture?.verdict ?? ""].join("|");
  const next: Tracker = {
    ...tr,
    firstConnectedAt,
    staleCosmeticDone,
    staleCapture,
    connectedAt: tr.connectedAt ?? (connected ? now : null),
    lastChangeAt: sig !== tr.lastSig ? now : tr.lastChangeAt,
    lastSig: sig,
    refusals: 0,
    refusingSince: null,
    lastPollOkAt: now,
    cosmeticSince: news.cosmeticDone ? tr.cosmeticSince ?? now : null,
    sawPattern: !!tr.sawPattern || displayablePattern(poll.pattern) !== "idle",
    sawSweep: !!tr.sawSweep || ["stripes", "red", "green", "blue"].includes(displayablePattern(poll.pattern)),
    idleSince: displayablePattern(poll.pattern) === "idle" ? tr.idleSince ?? now : null,
  };
  if (poll.state === "disabled" || poll.state === "failed") return { tracker: next, leave: poll.state };
  if (poll.handoffDone) return { tracker: next, leave: "handoff" };
  if (next.sawPattern && next.cosmeticSince != null && now - next.cosmeticSince >= GRACE_AFTER_COSMETIC_MS) return { tracker: next, leave: "grace" };
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

/**
 * GradeIQ's camera page never holds one pattern this long (its sweep waits 4 s
 * for an echo and moves on colour by colour), so a pattern unchanged for this
 * long means the camera page is gone — offer the way out over the pattern.
 */
export const PATTERN_STALL_MS = 90_000;

/** Why "Skip the camera check" is offered right now, or null if it isn't. `patternUp`: a pattern fills the screen. */
export function skipOffer(tr: Tracker, now: number, patternUp = false): "never-connected" | "stalled" | null {
  if (patternUp && now - tr.lastChangeAt >= PATTERN_STALL_MS) return "stalled";
  if (tr.connectedAt == null) return now - tr.startedAt >= NO_CONNECT_MS ? "never-connected" : null;
  return now - tr.lastChangeAt >= STALL_MS ? "stalled" : null;
}

/** The echo needs re-sending when the server's `shown` isn't what this screen is drawing (a lost POST). */
export function needsEcho(poll: ScreenPoll | null, drawing: string): boolean {
  return !poll || poll.shown !== drawing;
}

/**
 * GradeIQ's camera page ends its single pass with a photo of the phone's
 * Settings (V2Cam settingsScan: "Open Settings ▸ General ▸ About on the other
 * phone and take a photo"). It tells this phone nothing about it: after the
 * colour sweep it sets the pattern back to "idle" and waits for the advisor's
 * photo, and only then sends handoffDone. So "the sweep has run, the screen is back to
 * idle, and the camera hasn't finished" is when the customer is asked to open
 * Settings › About phone. It waits a moment first, so the second or two between
 * the last colour and the camera finishing (a journey without the Settings
 * photo) doesn't flash the prompt.
 */
export const SETTINGS_PROMPT_AFTER_MS = 2500;

export function settingsPrompt(tr: Tracker, poll: ScreenPoll | null, now: number): boolean {
  if (!poll || !tr.sawSweep || tr.idleSince == null) return false;
  if (displayablePattern(poll.pattern) !== "idle" || poll.handoffDone) return false;
  // Photos sent back for a retake: the advisor is photographing the outside again.
  // (cosmeticDone is no reason to hold back: a journey that grades straight away
  // sets it BEFORE the sweep, so it is already there while Settings is asked for.)
  const verdict = freshNews(tr, poll).capture?.verdict;
  if (verdict === "retake" || verdict === "retaking") return false;
  return now - tr.idleSince >= SETTINGS_PROMPT_AFTER_MS;
}

/**
 * GET /api/device/camera-link → { url }: GradeIQ's camera page for this check,
 * shown here as a QR for the advisor's tablet (the owner chose GradeIQ v2's own
 * link, PHONE-LED-FLOW.md decision 1). Only an http(s) URL is drawn; anything
 * else → null (no QR — the advisor opens the camera from the tablet instead).
 */
export function parseCameraLink(raw: unknown): string | null {
  const url = raw && typeof raw === "object" ? (raw as Record<string, unknown>).url : null;
  if (typeof url !== "string") return null;
  const t = url.trim();
  return /^https?:\/\/[^\s/]+\/\S*$/i.test(t) && t.length <= 2000 ? t : null;
}
