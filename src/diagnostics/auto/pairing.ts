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
// capture, connectedAt, released }. state disabled/failed → no camera check, move on;
// pending → wait; ready → show the pattern. 503 → keep polling. "The store's
// camera is there" = a NEW connectedAt (a camera page loaded after this screen
// mounted), or it asked for a pattern, or judged a capture. The QR itself comes
// from GET /api/device/camera-link → { url } (409 until GradeIQ is ready).
//
// The customer is never asked to skip the camera (owner, 2026-10-17: "the camera
// tests it; when it can't, the advisor certifies"). A server that says `released`
// (false until the advisor taps "Continue without camera" in SwapUp Store, by
// name) keeps the phone here until the camera finishes or the advisor lets it go.
// Only a server that never sends the key (older) keeps the 90 s "Skip the camera
// check" as before.
//
// After the scan the result screen can still show colours (./ResultColours on the
// phone): a camera page that comes back (followPoll — only NEWS counts), or the
// advisor's own check by eye (colourAt — the phone loops the test colours itself
// while GET /api/device/status says `colours`).
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
/**
 * Once a camera page is here, poll twice as often: GradeIQ's sweep waits 4 s for
 * the echo of each colour, and the echo is relayed phone → SwapUp → GradeIQ.
 */
export const POLL_FAST_MS = 350;
/** A lost echo (the server's `shown` isn't what is drawn) is sent again after this long. */
export const ECHO_RESEND_MS = 600;
/**
 * What this phone echoes when it leaves the scan screen: not a colour, so a phone that
 * LEFT can never answer a camera that asks for white (GradeIQ never clears `shown`).
 */
export const SHOWN_OFF = "off";
export const GRACE_AFTER_COSMETIC_MS = 30_000;
/**
 * "Skip camera" appears when the store's camera page has not opened in
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
  /**
   * The advisor let the phone go on without the camera (SwapUp Store, by name). null = the
   * server doesn't say — an older one, which still needs the customer's own way out.
   */
  released: boolean | null;
  /** The store's system can't read the camera service right now (a server for ≥ 0.8.0 says so instead of a 503). */
  unreachable?: boolean;
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
    // Fail closed: only an explicit true lets the phone go; a boolean false says the server knows the release.
    released: r.released === true ? true : r.released === false ? false : null,
    unreachable: r.unreachable === true,
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
  /** The server sends `released` (even false): the advisor lets the phone go, so the customer is offered no skip. */
  releaseKnown?: boolean;
};

export function newTracker(now: number): Tracker {
  return { startedAt: now, connectedAt: null, cosmeticSince: null, lastChangeAt: now, lastSig: "", refusals: 0, refusingSince: null, lastPollOkAt: null };
}

/**
 * handoff / grace: the camera is done with this phone. disabled / failed: no camera grading
 * for this check — go to Done. released: the advisor went on without the camera.
 */
export type Leave = "handoff" | "grace" | "disabled" | "failed" | "released" | "alone";

/**
 * The store's camera page never connected in this long, on a server that lets the advisor release
 * the phone: an advisor who can't (an older SwapUp Store has no release button) or a camera service
 * that is down must not keep the customer on Scan for ever — the phone goes on BY ITSELF (no skip
 * button: the customer still never decides to go without the camera) and the advisor checks the
 * screen by eye.
 */
export const MOVE_ON_ALONE_MS = 5 * 60_000;

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
    releaseKnown: !!tr.releaseKnown || poll.released !== null,
  };
  if (poll.state === "disabled" || poll.state === "failed") return { tracker: next, leave: poll.state };
  if (poll.handoffDone) return { tracker: next, leave: "handoff" };
  if (poll.released === true) return { tracker: next, leave: "released" };
  if (next.releaseKnown && next.connectedAt == null && now - next.startedAt >= MOVE_ON_ALONE_MS) return { tracker: next, leave: "alone" };
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

/**
 * Why "Skip camera" is offered right now, or null if it isn't. `patternUp`: a
 * pattern fills the screen. Never on a server that lets the advisor release the phone
 * (`releaseKnown`): the customer is not the one who decides to go without the camera.
 */
export function skipOffer(tr: Tracker, now: number, patternUp = false): "never-connected" | "stalled" | null {
  if (tr.releaseKnown) return null;
  if (patternUp && now - tr.lastChangeAt >= PATTERN_STALL_MS) return "stalled";
  if (tr.connectedAt == null) return now - tr.startedAt >= NO_CONNECT_MS ? "never-connected" : null;
  return now - tr.lastChangeAt >= STALL_MS ? "stalled" : null;
}

/** The echo needs re-sending when the server's `shown` isn't what this screen is drawing (a lost POST). */
export function needsEcho(poll: ScreenPoll | null, drawing: string): boolean {
  return !poll || poll.shown !== drawing;
}

/** How long until the next /screen poll: faster once the store's camera page is here. */
export function pollEvery(tr: Pick<Tracker, "connectedAt">): number {
  return tr.connectedAt != null ? POLL_FAST_MS : POLL_MS;
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

// ── after the scan: the result screen ───────────────────────────────────────

/**
 * The result screen keeps an eye on /screen too, so a camera page that comes back
 * after the scan (a retake from the tablet, "Take photos anyway", a Retry) gets its
 * colours: GradeIQ's sweep can only capture a phone that shows them. Only NEWS counts
 * — whatever /screen held when the result screen opened (a pattern a failed sweep left
 * behind, an old connectedAt) is the baseline, never drawn. A pattern that sits
 * unchanged for PATTERN_STALL_MS means the camera page has gone: back to the result.
 */
export type Follow = {
  /** /screen as first read on this screen. undefined = no poll yet. */
  base?: { pattern: string; connectedAt: string | null };
  /** A camera page is driving this screen now. */
  live: boolean;
  /** When the drawn pattern last changed. */
  since: number;
  last: string;
};

export function newFollow(now: number): Follow {
  return { live: false, since: now, last: "idle" };
}

/** Fold one /screen poll into the follow state; `draw` is what the result screen shows ("idle" = itself). */
export function followPoll(f: Follow, poll: ScreenPoll, now: number): { follow: Follow; draw: string } {
  const want = displayablePattern(poll.pattern);
  if (poll.state === "disabled" || poll.state === "failed") return { follow: { ...f, live: false, last: "idle", since: now }, draw: "idle" };
  if (!f.base) return { follow: { ...f, base: { pattern: want, connectedAt: poll.connectedAt } }, draw: "idle" };
  const news = (!!poll.connectedAt && poll.connectedAt !== f.base.connectedAt) || want !== f.base.pattern;
  const live = f.live || news;
  if (!live) return { follow: f, draw: "idle" };
  const since = want !== f.last ? now : f.since;
  // Stuck on one colour for 90 s: the camera page is gone. That pattern becomes the new baseline.
  if (want !== "idle" && now - since >= PATTERN_STALL_MS)
    return { follow: { base: { pattern: want, connectedAt: poll.connectedAt }, live: false, since: now, last: "idle" }, draw: "idle" };
  return { follow: { ...f, live, since, last: want }, draw: want };
}

/**
 * The advisor's check by eye (SwapUp Store "Check the phone"): while GET
 * /api/device/status says `colours`, the result screen loops these full-screen,
 * COLOUR_STEP_MS each — white and black first (lines, dead or stuck pixels), the
 * three primaries (tint, burn-in), then the stripes. The customer taps nothing.
 */
export const ADVISOR_COLOURS = ["white", "black", "red", "green", "blue", "stripes"] as const;
export const COLOUR_STEP_MS = 2500;

export function colourAt(startedAt: number, now: number): (typeof ADVISOR_COLOURS)[number] {
  const i = Math.floor(Math.max(0, now - startedAt) / COLOUR_STEP_MS) % ADVISOR_COLOURS.length;
  return ADVISOR_COLOURS[i];
}

/**
 * How long a "show the colours" from the store stays good without a fresh status:
 * past this (Wi‑Fi gone, the store app closed) the loop stops on its own, so a phone
 * is never left flashing colours nobody is looking at.
 */
export const COLOURS_FRESH_MS = 20_000;

export function coloursOn(saidAt: number | null, now: number): boolean {
  return saidAt != null && now - saidAt < COLOURS_FRESH_MS;
}
