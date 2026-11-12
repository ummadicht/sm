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
  /** The customer started this trade-in from the store's counter code (no advisor yet). Nothing more is asked: the advisor fills the customer in at the trade-in. */
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
  /** true = "Yes, it's mine"; false = "No"; null = nothing was shown to confirm. */
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
  /** Once applied: the public grade report, "/r/<token>" (the report page itself has no prices). Read through ./report.ts customerReport. */
  reportPath?: string | null;
  /** Once applied: the SwapUp grade that report opens on ("Good (B)"), the label printed as sent. */
  grading?: { status: string; label: string; grade: string | null; letter: string | null; final: boolean } | null;
  /**
   * Once applied: THE ANSWER — the grade, the market price, what we pay, the bonus and the repair,
   * every word and number the server's (../shared/answer.ts readAnswer). null = none yet; absent =
   * an older server, which sends no prices to the phone.
   */
  answer?: unknown;
  /**
   * The advisor is checking the screen by eye in SwapUp Store ("Check the phone"): the
   * result screen shows the test colours full-screen until this goes false. Only an
   * explicit true counts; an older server never sends it.
   */
  colours?: boolean;
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
  /** When the Identify step was finished (a model picked, or left to the advisor). Absent = not yet, a recognised phone (never asked), or an older app. */
  identifiedAt?: string | null;
  /** How the battery-health screenshot step ended. Absent = not yet (or no such step for this check). */
  battery?: BatteryRec | null;
  /**
   * What this phone said about itself when it joined — the picker's "We couldn't tell the
   * exact model from its code (…)" and the battery guide. `measured`: it read its own
   * storage size, so the picker never asks for one.
   */
  reported?: { brand: string | null; modelCode: string | null; measured?: boolean } | null;
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
 * skipped     — the advisor went on without the camera (SwapUp Store, by name) — or, on an
 *               older server, the customer tapped "Skip camera"
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

// ---------------------------------------------------------------- identity (the Identify step)

export type IdentityMatch = "exact" | "family" | "none";

/**
 * The join response's `identity` (swapup docs/PHONE-LED-FLOW.md): the server's
 * matchModel on the phone's own model code — by code only, never a marketing
 * name — and never a price. `reason` is the server's explanation (staff words).
 * A match means the phone is recognised and nothing is asked (identifyDone).
 * `variants` = that model's storage sizes ([] from an older server, with no match,
 * or when the phone measured its size); kept as sent, the customer is not asked.
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
 * server records them `via: "counter code"`; an explicit flag is read too. The
 * phone no longer asks such a customer for a mobile number or a name — the
 * advisor takes them on the trade-in form.
 */
export function startedByCustomer(rawSession: unknown): boolean {
  if (!rawSession || typeof rawSession !== "object") return false;
  const r = rawSession as Record<string, unknown>;
  return r.customerStarted === true || r.startedBy === "customer" || r.via === "counter code";
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

/**
 * The three damage questions an older browser check asked have all been answered. The
 * customer is no longer asked about condition (owner, 2026-10-17): the camera checks it,
 * and the advisor certifies what the camera couldn't. Kept to recognise a check saved by
 * an older app.
 */
export function damageAnswered(d: Declared | null | undefined): boolean {
  return !!d && d.screenCracked !== null && d.backCracked !== null && d.liquid !== null;
}

/**
 * The store named this phone EXACTLY from its own model code: there is nothing to ask (owner,
 * 2026-10-17: "'Is this your phone?' only when the model match is not exact"). A family match
 * (a regional version of a model on file) gets the one-tap confirm; no match gets the picker.
 */
export function recognised(identity: Identity | null | undefined): boolean {
  return !!identity && identity.match === "exact" && !!identity.label;
}

/**
 * "Is this your phone?" — the one-tap confirm for a family match: the model the store
 * matched, and its storage sizes ONLY when the phone couldn't measure its own (the server
 * then sends the model's sizes; a measured phone gets none). null = no confirm card: an exact
 * match (nothing to ask) or no match (the picker asks instead).
 */
export function confirmAsk(identity: Identity | null | undefined): { label: string; modelId: string | null; sizes: string[] } | null {
  if (!identity || identity.match !== "family" || !identity.label) return null;
  const sizes = !identity.variant && identity.modelId && identity.variants.length > 1 ? identity.variants : [];
  return { label: identity.variant ? `${identity.label} · ${identity.variant}` : identity.label, modelId: identity.modelId, sizes };
}

/**
 * The Identify step is behind this check. It has a screen only for a phone the store
 * could not name exactly from its model code: "Is this your phone?" (a family match) or
 * "Which phone is this?" (no match) — the one thing no test can tell. An exact match is
 * never asked anything (no IMEI, no storage, no name): the advisor confirms those at the
 * trade-in.
 */
export function identifyDone(st: CheckState): boolean {
  return !!st.identifiedAt || startedBeforeIdentify(st) || recognised(st.session.identity);
}

/**
 * What the phone records for `display` when its scan ended without the camera: "not
 * tested", with the reason — never missing, never passed. The camera's sweep or the
 * advisor's certification decide it on the server (its worse-of rule lets either win).
 * null when there is nothing to record: the camera ran, the plan has no display test,
 * or it already has a result.
 */
export function displayAfterScan(rec: Pick<PairingRec, "outcome" | "reason">, planIds: string[], results: Record<string, unknown>): Detail | null {
  if (rec.outcome !== "skipped" && rec.outcome !== "unavailable") return null;
  if (!planIds.includes("display") || results.display) return null;
  return { method: "store camera sweep", photos: rec.outcome, reason: `not camera-checked: ${rec.reason ?? rec.outcome}` };
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

/**
 * What POST /api/device/phase reports, so the store's tablet can say where the customer's
 * phone is. "colours": on its result screen, showing the test colours for the advisor's
 * check by eye (an older server refuses it — harmless, the phone just stops sending it).
 */
export type PhonePhase = "identify" | "scan" | "battery" | "test" | "done" | "colours";

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

export type WebStep = "welcome" | "identify" | "scan" | "battery" | "runner" | "done";

/**
 * Where a (resumed) BROWSER check is. The phone-led order where a browser can
 * follow it (swapup docs/PHONE-LED-FLOW.md): welcome → Identify (only for a phone
 * the store couldn't recognise) → Scan → battery screenshot → the guided tests →
 * done. No damage questions: the camera checks the condition and the advisor
 * certifies what it couldn't. A check begun before the Identify step existed skips
 * the new steps rather than jumping back to them mid-run.
 */
export function resumeStep(st: CheckState, supportedIds: string[]): WebStep {
  if (!st.consentAt) return "welcome";
  if (!startedBeforeIdentify(st)) {
    if (!identifyDone(st)) return "identify";
    if (!st.pairing) return "scan";
    if (wantsBatteryStep(st.session.plan) && !st.battery) return "battery";
  }
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
