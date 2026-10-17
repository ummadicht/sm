// Pure logic for SwapUp Check — no React Native imports, so it can be compiled
// and exercised in plain Node (src/diagnostics/auto/phoneled.test.ts) as well as in the app.
// Contract: ~/projects/swapup/docs/MOBILE-API.md §4; the phone-led order
// (Identify › Scan › Test › Result): ~/projects/swapup/docs/PHONE-LED-FLOW.md.

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

export type Outcome = "pass" | "fail" | "skip" | "unsupported";
export type Detail = Record<string, string | number | boolean | null>;
export type PlanItem = { id: string; name: string; critical: boolean };

export type SessionInfo = {
  id: string;
  caseRef: string;
  storeName: string;
  plan: PlanItem[];
  server: string;
  /** What the server made of this phone's own model code at join (phone-led flow). Absent from an older server. */
  identity?: Identity | null;
  /** The customer started this trade-in from the store's counter code (no advisor yet), so the app also asks for a mobile number and name. */
  customerStarted?: boolean;
};

export type Declared = {
  screenCracked: boolean | null;
  backCracked: boolean | null;
  liquid: boolean | null;
  imei: string | null;
  // The Identify step (swapup docs/PHONE-LED-FLOW.md). Optional: a check saved by an
  // older app, or the browser's damage questions on their own, never set them.
  imei2?: string | null;
  /** true = "Yes, that's my phone"; false = "No"; null = nothing was shown to confirm. */
  identityConfirmed?: boolean | null;
  /** The customer's own pick when the phone wasn't recognised (or they said "No") — a CLAIM, never a match. */
  picked?: { modelId: string; variant: string | null } | null;
  customerName?: string | null;
  customerPhone?: string | null;
};

export type ResultRec = { outcome: Outcome; detail: Detail | null; at: string };

/** The contract's DeviceInfo (the `device` of a TestSessionView). */
export type ContractDevice = {
  brand: string | null;
  manufacturer: string | null;
  modelName: string | null;
  modelCode: string | null;
  osVersion: string | null;
  totalDiskBytes: number | null;
  totalMemoryBytes: number | null;
  batteryLevelPct: number | null;
  /** null = can't tell (a browser can't). */
  isPhysicalDevice: boolean | null;
  appVersion: string;
};

export type JoinResponse = { ticket: string; session: SessionInfo };
export type RemoteStatus = {
  status: "waiting" | "opened" | "joined" | "testing" | "complete" | "applied" | "expired" | "cancelled" | string;
  progress?: { done: number; total: number };
  storeName?: string;
  caseRef?: string;
};

/** Everything the app keeps on disk for the current check (one session at a time). */
export type CheckState = {
  v: 1;
  server: string;
  code: string;
  ticket: string | null;
  session: SessionInfo;
  joinedAt: string;
  consentAt: string | null;
  declared: Declared | null;
  /** `at` of the declaration the server acknowledged. */
  declaredSentAt: string | null;
  declaredAt: string | null;
  /** The server refused the answers (4xx) — kept so results are not blocked behind them; cleared on a new answer. */
  declareError?: string | null;
  /** Local truth: the latest result per test id. */
  results: Record<string, ResultRec>;
  /** testId → `at` the server acknowledged. A result is pending while acked !== results[id].at. */
  acked: Record<string, string>;
  /** When the customer finished (or re-finished after a re-run); `completeSentAt` = acknowledged. */
  completeAt: string | null;
  completeSentAt: string | null;
  /** Set when the server says the session is gone (expired / cancelled / used elsewhere). */
  ended: string | null;
  /**
   * How the Scan screen (the store photographing this phone through GradeIQ's
   * camera page) ended. Absent = not finished yet.
   */
  pairing?: PairingRec | null;
  /** When the Identify step was finished (phone confirmed or picked, IMEI given or skipped). Absent = not yet, or an older app. */
  identifiedAt?: string | null;
  /** How the battery-health screenshot step ended. Absent = not yet (or no such step for this check). */
  battery?: BatteryRec | null;
  /** What this phone said about itself when it joined — the Identify card's "Your phone calls itself …" and the battery guide. */
  reported?: { brand: string | null; modelCode: string | null } | null;
};

/**
 * read        — GradeIQ read a health % off the screenshot
 * unreadable  — a screenshot was sent but no % could be read, and the customer moved on
 * skipped     — the customer skipped the step without a reading
 * unavailable — the store's system has no battery reader (an older server)
 */
export type BatteryRec = { outcome: "read" | "unreadable" | "skipped" | "unavailable"; healthPct: number | null; at: string };

/**
 * handoff     — the camera page said it was finished (handoffDone)
 * grace       — photos were accepted but the camera never said finished; left after 30 s (as GradeIQ's /v2 does)
 * skipped     — the customer tapped "Skip the camera check" (the store never connected / stalled)
 * unavailable — the server refused the pairing calls (no camera grading for this check)
 */
export type PairingRec = { outcome: "handoff" | "grace" | "skipped" | "unavailable"; at: string; reason: string | null };

// ---------------------------------------------------------------- codes + links

/** Uppercase, drop spaces/dashes. Returns the cleaned string and whether anything outside the alphabet was typed. */
export function cleanCode(raw: string): { code: string; invalidChars: string[] } {
  const up = (raw || "").toUpperCase().replace(/[\s\-_.]/g, "");
  const invalid: string[] = [];
  let code = "";
  for (const ch of up) {
    if (CODE_ALPHABET.includes(ch)) code += ch;
    else if (!invalid.includes(ch)) invalid.push(ch);
  }
  return { code: code.slice(0, CODE_LENGTH), invalidChars: invalid };
}

export function isValidCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

export type JoinTarget = { code: string; server: string | null };

function cleanServer(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(t)) return null;
  return t;
}

/**
 * What a scanned QR or an opened link means:
 *  - swapupcheck://join?code=K7M2QX&server=https%3A%2F%2F…
 *  - https://host[/base]/j/K7M2QX            (the store's test QR / download page)
 *  - https://host[/base]/app/check/?code=K7M2QX[&server=…]  (the browser check — the
 *    join page's "Test in this browser" link; no server → the page's own host)
 *  - a bare 6-character code
 * Returns null for anything else. `kind: "wifi"` flags the store's Wi‑Fi QR so
 * the screen can say what to do with it instead of "not recognised".
 */
export function parseJoinTarget(raw: string): (JoinTarget & { kind: "join" }) | { kind: "wifi" } | null {
  const s = (raw || "").trim();
  if (!s) return null;
  if (/^WIFI:/i.test(s)) return { kind: "wifi" };

  // Deep link (also tolerates swapupcheck:join?… and swapupcheck:///join?…)
  const deep = s.match(/^swapupcheck:\/*join\/?\?(.*)$/i);
  if (deep) {
    const q = parseQuery(deep[1]);
    const { code } = cleanCode(q.code || "");
    if (!isValidCode(code)) return null;
    return { kind: "join", code, server: cleanServer(q.server) };
  }

  // https://host[/base]/app/check/?code=CODE[&server=…] — the browser version of the app
  const browser = s.match(/^(https?:\/\/[^\s?#]*?)\/app\/check\/?(?:index\.html)?\?([^#]*)(?:#.*)?$/i);
  if (browser) {
    const q = parseQuery(browser[2]);
    const { code } = cleanCode(q.code || "");
    if (!isValidCode(code)) return null;
    return { kind: "join", code, server: cleanServer(q.server) ?? cleanServer(browser[1]) };
  }

  // https://host/…/j/CODE (optionally with a trailing slash, query or hash)
  const web = s.match(/^(https?:\/\/[^\s?#]*?)\/j\/([A-Za-z0-9]{6})\/?(?:[?#].*)?$/i);
  if (web) {
    const { code } = cleanCode(web[2]);
    if (!isValidCode(code)) return null;
    return { kind: "join", code, server: cleanServer(web[1]) };
  }

  // A bare code
  if (/^[A-Za-z0-9\s-]{6,8}$/.test(s)) {
    const { code, invalidChars } = cleanCode(s);
    if (isValidCode(code) && invalidChars.length === 0) return { kind: "join", code, server: null };
  }
  return null;
}

function parseQuery(q: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of q.split(/[&;]/)) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = i < 0 ? part : part.slice(0, i);
    const v = i < 0 ? "" : part.slice(i + 1);
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " "));
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function hostOf(server: string): string {
  const m = server.match(/^https?:\/\/([^/]+)/i);
  return m ? m[1] : server;
}

// ---------------------------------------------------------------- IMEI

/** IMEI check digit (Luhn over all 15 digits) — same rule as SwapUp lib/domain/imei.ts. */
export function imeiLuhnValid(digits: string): boolean {
  if (!/^\d{15}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export type ImeiCheck = { ok: true; imei: string } | { ok: false; message: string } | { ok: null };

/** Validate what the customer typed. Empty = not given (fine — it's optional). */
export function checkImei(raw: string): ImeiCheck {
  const d = (raw || "").replace(/\D/g, "");
  if (!d) return { ok: null };
  if (d.length < 15) return { ok: false, message: `An IMEI has 15 digits — this has ${d.length}. Check the number on the screen after dialling *#06#.` };
  if (d.length > 15) return { ok: false, message: `An IMEI has 15 digits — this has ${d.length}. If two numbers are shown, type only IMEI 1.` };
  if (!imeiLuhnValid(d)) return { ok: false, message: "That number doesn't add up — one digit is probably mistyped. Check each digit against the screen." };
  return { ok: true, imei: d };
}

/**
 * The IMEIs in pasted text — what *#06# shows, copied as it comes: "IMEI 1
 * 356938 03 564380 9 / 01", two numbers on one line, a software version after
 * a slash. A block of exactly 15 digits is an IMEI as it stands (a bad check
 * digit is then shown, not hidden). Digits split by single spaces or dashes are
 * joined only where the join makes 15 digits that pass the check digit, and a
 * 30- or 45-digit block likewise — anything else would be a guess. A 16-digit
 * IMEISV or a serial is ignored. Order kept, no repeats.
 */
export function imeisFromText(input: string): string[] {
  const out: string[] = [];
  const add = (d: string) => {
    if (!out.includes(d)) out.push(d);
  };
  for (const run of (input || "").match(/\d(?:[ -]?\d)*/g) ?? []) {
    // "1 356938035643809" is "IMEI 1" running into the number, so a run is cut
    // into its groups and 15-digit windows of consecutive groups are tried.
    // `asWritten`: a group typed as exactly 15 digits — the only kind kept without the check digit.
    const groups = run.split(/[ -]/).flatMap((g) =>
      g.length > 15 && g.length % 15 === 0 ? (g.match(/\d{15}/g) ?? []).map((d) => ({ d, asWritten: false })) : [{ d: g, asWritten: g.length === 15 }]
    );
    let i = 0;
    while (i < groups.length) {
      let acc = "";
      let end = -1;
      for (let j = i; j < groups.length && acc.length < 15; j++) {
        acc += groups[j].d;
        if (acc.length === 15 && ((j === i && groups[j].asWritten) || imeiLuhnValid(acc))) end = j;
      }
      if (end >= 0) {
        add(acc);
        i = end + 1;
      } else i++;
    }
  }
  return out;
}

/** Indian mobile: 10 digits starting 6–9, with an optional +91 / 0 in front. Empty is fine (it's optional). Same rule as the store app's find-by-mobile. */
export function cleanMobile(input: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const digits = (input || "").replace(/[\s\-().]/g, "");
  if (!digits) return { ok: true, value: null };
  const m = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(digits);
  return m ? { ok: true, value: m[1] } : { ok: false, message: "A mobile number has 10 digits and starts with 6, 7, 8 or 9." };
}

/** A name as typed: spaces tidied, at most 60 characters. Empty → null (it's optional). */
export function cleanName(input: string): string | null {
  const t = (input || "").replace(/\s+/g, " ").trim().slice(0, 60).trim();
  return t || null;
}

// ---------------------------------------------------------------- identity (the Identify step)

export type IdentityMatch = "exact" | "family" | "none";

/**
 * The join response's `identity` (swapup docs/PHONE-LED-FLOW.md): the server's
 * matchModel on the phone's own model code — by code only, never a marketing
 * name — and never a price. `reason` is the server's explanation (staff words).
 * `variants` = that model's storage sizes, so the confirm card can ask which one
 * when the phone couldn't measure it; [] from an older server, with no match, or
 * when the phone DID measure a size — even one not on file (a 1TB S23 Ultra): the
 * customer is never asked a question the phone already answered.
 */
export type Identity = { label: string | null; match: IdentityMatch; reason: string | null; variant: string | null; modelId: string | null; variants: string[] };

const nonEmpty = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** null = the server sent none (an older server). A "match" with no name to show is treated as none: there is nothing the customer could confirm. */
export function parseIdentity(raw: unknown): Identity | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const label = nonEmpty(r.label);
  const matched = (r.match === "exact" || r.match === "family") && !!label;
  return {
    label,
    match: matched ? (r.match as IdentityMatch) : "none",
    // matchModel calls it `why`; the contract `reason`.
    reason: nonEmpty(r.reason) ?? nonEmpty(r.why),
    variant: matched ? nonEmpty(r.variant) : null,
    modelId: matched ? nonEmpty(r.modelId) : null,
    variants: matched && Array.isArray(r.variants) ? [...new Set(r.variants.map(nonEmpty).filter((v): v is string => !!v))] : [],
  };
}

/**
 * Was this session started by the customer from the store's counter code? The
 * contract says such sessions also ask for a mobile number and a name, and that
 * the server records them `via: "counter code"`; an explicit flag is read too.
 */
export function startedByCustomer(rawSession: unknown): boolean {
  if (!rawSession || typeof rawSession !== "object") return false;
  const r = rawSession as Record<string, unknown>;
  return r.customerStarted === true || r.startedBy === "customer" || r.via === "counter code";
}

/** "Samsung Galaxy S23 Ultra · 256 GB" — the Identify card's headline. */
export function identityLine(label: string, variant: string | null | undefined): string {
  return variant ? `${label} · ${variant}` : label;
}

/**
 * The confirm card's "How much storage?" (swapup offer spec A10). Asked only when
 * the phone was recognised, couldn't measure its storage, and the model comes in
 * more than one size: one size the server fills from the catalogue, and a
 * measured size always wins on the server. The answer is a CLAIM the advisor
 * checks in Settings before the trade-in, never a measurement.
 */
export function confirmStorage(identity: Identity | null | undefined): { ask: boolean; options: string[] } {
  if (!identity || identity.match === "none" || !identity.label || !identity.modelId || identity.variant) return { ask: false, options: [] };
  // A check saved by an app older than `variants` has none on its identity.
  const options = Array.isArray(identity.variants) ? identity.variants : [];
  return options.length > 1 ? { ask: true, options } : { ask: false, options: [] };
}

/** One phone in the picker (GET /api/device/models?brand=…). No prices — the server never sends them here. */
export type ModelRef = { id: string; brand: string; model: string; variants: string[] };

/** GET /api/device/models → the brand list. null = not that shape (an older server, or an error page). */
export function parseBrands(raw: unknown): string[] | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || !Array.isArray(r.brands)) return null;
  const out: string[] = [];
  for (const b of r.brands) {
    const t = nonEmpty(b);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** GET /api/device/models?brand=… → that brand's models. null = not that shape. */
export function parseModels(raw: unknown): ModelRef[] | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || !Array.isArray(r.models)) return null;
  const out: ModelRef[] = [];
  for (const m of r.models) {
    const o = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
    const id = nonEmpty(o?.id);
    const model = nonEmpty(o?.model);
    if (!o || !id || !model || out.some((x) => x.id === id)) continue;
    const variants = Array.isArray(o.variants) ? o.variants.map(nonEmpty).filter((v): v is string => !!v) : [];
    out.push({ id, brand: nonEmpty(o.brand) ?? "", model, variants: [...new Set(variants)] });
  }
  return out;
}

/** The model list gets a search box past this many (GradeIQ's ManualDevicePicker does the same). */
export const MODEL_SEARCH_FROM = 12;

/** Models whose name contains every word typed ("s23 ul" finds "Galaxy S23 Ultra"). */
export function filterModels(models: ModelRef[], query: string): ModelRef[] {
  const words = (query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return models;
  return models.filter((m) => {
    const name = m.model.toLowerCase();
    return words.every((w) => name.includes(w));
  });
}

// ---------------------------------------------------------------- steps

/** The plan id of the battery-health screenshot step. The server records its result itself (POST /api/device/battery). */
export const BATTERY_HEALTH_ID = "battery_health";

/** The battery step only runs where the server put it in the plan — an older server has no reader for the screenshot. */
export function wantsBatteryStep(plan: { id: string }[]): boolean {
  return plan.some((p) => p.id === BATTERY_HEALTH_ID);
}

/** The three damage questions of the browser flow have all been answered. */
export function damageAnswered(d: Declared | null | undefined): boolean {
  return !!d && d.screenCracked !== null && d.backCracked !== null && d.liquid !== null;
}

/**
 * A check begun by an app that had no Identify step (0.5.x and older): it has
 * results, a finished camera step or the browser's answers, but no
 * `identifiedAt`. Such a check carries on where it was instead of being sent
 * back to the start. "Can't run here" bookkeeping (`unsupported`) is not a
 * test having run, so it doesn't count.
 */
export function startedBeforeIdentify(st: CheckState): boolean {
  if (st.identifiedAt) return false;
  return Object.values(st.results).some((r) => r.outcome !== "unsupported") || !!st.pairing || damageAnswered(st.declared);
}

/** What POST /api/device/phase reports, so the store's tablet can say where the customer's phone is. */
export type PhonePhase = "identify" | "scan" | "battery" | "test" | "done";

/** A native or browser step → the phase the store hears about. Everything that tests the phone is "test". */
export function phaseFor(step: string): PhonePhase {
  switch (step) {
    case "welcome":
    case "identify":
      return "identify";
    case "scan":
      return "scan";
    case "battery":
      return "battery";
    case "done":
      return "done";
    default:
      return "test";
  }
}

// ---------------------------------------------------------------- results

/** A strictly increasing ISO timestamp, so a re-run always beats the earlier result even if the clock moved back. */
export function nextAt(prev: string | null | undefined, now: Date = new Date()): string {
  const t = now.getTime();
  const p = prev ? Date.parse(prev) : NaN;
  return new Date(isFinite(p) && p >= t ? p + 1 : t).toISOString();
}

export function pendingResultIds(st: CheckState): string[] {
  return Object.keys(st.results).filter((id) => st.acked[id] !== st.results[id].at);
}

export function declarePending(st: CheckState): boolean {
  return !!st.declared && !!st.declaredAt && st.declaredSentAt !== st.declaredAt && !st.declareError;
}

export function completePending(st: CheckState): boolean {
  return !!st.completeAt && st.completeSentAt !== st.completeAt;
}

export function unsentCount(st: CheckState): number {
  return pendingResultIds(st).length + (declarePending(st) ? 1 : 0);
}

export type Counts = { passed: number; failed: number; skipped: number; unsupported: number; done: number; total: number };

export function countResults(plan: PlanItem[], results: Record<string, ResultRec>): Counts {
  const c: Counts = { passed: 0, failed: 0, skipped: 0, unsupported: 0, done: 0, total: plan.length };
  for (const p of plan) {
    const r = results[p.id];
    if (!r) continue;
    c.done++;
    if (r.outcome === "pass") c.passed++;
    else if (r.outcome === "fail") c.failed++;
    else if (r.outcome === "unsupported") c.unsupported++;
    else c.skipped++;
  }
  return c;
}

export type WebStep = "welcome" | "identify" | "scan" | "battery" | "questions" | "runner" | "done";

/**
 * Where a (resumed) BROWSER check is. The phone-led order where a browser can
 * follow it (swapup docs/PHONE-LED-FLOW.md): welcome → Identify → Scan →
 * battery screenshot → the damage questions → the guided tests → done. A check
 * begun before the Identify step existed skips the new steps rather than
 * jumping back to them mid-run.
 */
export function resumeStep(st: CheckState, supportedIds: string[]): WebStep {
  if (!st.consentAt) return "welcome";
  if (!startedBeforeIdentify(st)) {
    if (!st.identifiedAt) return "identify";
    if (!st.pairing) return "scan";
    if (wantsBatteryStep(st.session.plan) && !st.battery) return "battery";
  }
  if (!damageAnswered(st.declared)) return "questions";
  if (supportedIds.some((id) => !st.results[id])) return "runner";
  return "done";
}

export function newInstallId(rand: () => number = Math.random): string {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  const g = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (g?.getRandomValues) {
    const bytes = g.getRandomValues(new Uint8Array(24));
    for (const b of bytes) s += a[b % a.length];
  } else {
    for (let i = 0; i < 24; i++) s += a[Math.floor(rand() * a.length)];
  }
  return "inst_" + s;
}

// ---------------------------------------------------------------- browser identity

/**
 * What a browser's user-agent string says about the phone it runs on. Pure, so
 * it is testable in Node; check/deviceInfo.web.ts adds the User-Agent Client
 * Hints answer (Chrome on Android gives the real model code there, e.g.
 * "SM-S901E") on top.
 *
 * Honest about the traps:
 *  - Chrome's reduced UA says "Android 10; K" on every phone — "K" is not a
 *    model and "10" is not the Android version, so both come back null.
 *  - Samsung Internet writes "SAMSUNG SM-S901E"; old UAs append "Build/…".
 *  - An iPhone's UA never says which iPhone; Safari 26 freezes the OS at 18_6.
 *  - An iPad in desktop mode claims to be a Mac (only touch points give it away).
 */
export type UaInfo = {
  os: "android" | "ios" | "other";
  brand: string | null;
  modelName: string | null;
  modelCode: string | null;
  osVersion: string | null;
  mobile: boolean;
};

/** Brand from a model code — only where the code itself says so (never a guess). */
export function brandForModel(model: string | null): string | null {
  if (!model) return null;
  const m = model.trim().toUpperCase();
  // Samsung: SM-…, older GT-…, Japanese carrier SC-…/SCG…/SCV…
  if (/^(SM|GT|SC)-|^SC[GV]\d/.test(m)) return "samsung";
  if (/^PIXEL\b/.test(m)) return "google";
  return null;
}

/** "13.0.0" → "13", "14.1.0" → "14.1" (Android reports a major version; trailing zeros add nothing). */
export function trimVersion(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim().replace(/_/g, ".");
  if (!/^\d+(\.\d+)*$/.test(t)) return null;
  return t.replace(/(\.0+)+$/, "");
}

const NOT_A_MODEL = /^(mobile|tablet|wv|u|k|linux|[a-z]{2}(?:[-_][a-z]{2,4})?|rv:.*|x11|arm.*|aarch64)$/i;

export function parseUserAgent(ua: string, maxTouchPoints = 0): UaInfo {
  const s = ua || "";
  const out: UaInfo = { os: "other", brand: null, modelName: null, modelCode: null, osVersion: null, mobile: /Mobi|Android|iPhone|iPod/i.test(s) };

  const ios = s.match(/\((iPhone|iPad|iPod)[^)]*?OS (\d+(?:_\d+)*)/i);
  if (ios) {
    const kind = ios[1].toLowerCase() === "ipad" ? "iPad" : ios[1].toLowerCase() === "ipod" ? "iPod" : "iPhone";
    out.os = "ios";
    out.brand = "Apple";
    out.modelName = kind;
    out.mobile = true;
    let v = trimVersion(ios[2]);
    // Safari 26+ freezes the OS token (at 18_6) while its own Version/ moves on.
    const safari = s.match(/Version\/(\d+)/);
    if (v && safari && Number(safari[1]) > Number(v.split(".")[0])) v = null;
    out.osVersion = v;
    return out;
  }
  if (/\bMacintosh\b/.test(s) && maxTouchPoints > 1) {
    // iPadOS asks for desktop sites by default and sends a Mac UA.
    out.os = "ios";
    out.brand = "Apple";
    out.modelName = "iPad";
    out.mobile = true;
    return out;
  }

  const paren = s.match(/\(([^)]*\bAndroid\b[^)]*)\)/i);
  if (paren) {
    out.os = "android";
    out.mobile = true;
    const parts = paren[1].split(";").map((p) => p.trim()).filter(Boolean);
    const ai = parts.findIndex((p) => /^Android\b/i.test(p));
    const ver = ai >= 0 ? parts[ai].match(/^Android\s+([\d.]+)/i) : null;
    let model: string | null = null;
    for (const p of parts.slice(ai + 1)) {
      const cleaned = p.replace(/\s*Build\/.*$/i, "").replace(/^SAMSUNG\s+/i, "").trim();
      if (!cleaned || NOT_A_MODEL.test(cleaned)) continue;
      model = cleaned;
      break;
    }
    const reduced = /;\s*K\s*$/.test(paren[1]) || (parts[parts.length - 1] || "") === "K";
    out.modelCode = model;
    out.modelName = model;
    out.brand = brandForModel(model);
    // The reduced UA pins every phone to "Android 10" — that number means nothing.
    out.osVersion = reduced ? null : trimVersion(ver ? ver[1] : null);
    return out;
  }
  return out;
}
