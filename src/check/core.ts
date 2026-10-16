// Pure logic for SwapUp Check — no React Native imports, so it can be compiled
// and exercised in plain Node (scratch tests) as well as in the app.
// Contract: ~/projects/swapup/docs/MOBILE-API.md §4.

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
};

export type Declared = {
  screenCracked: boolean | null;
  backCracked: boolean | null;
  liquid: boolean | null;
  imei: string | null;
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
   * Native app only: how the pairing screen (the store photographing this phone
   * through GradeIQ's camera page) ended. Absent = not finished yet / browser build.
   */
  pairing?: PairingRec | null;
};

/**
 * handoff     — the camera page said it was finished (handoffDone)
 * grace       — photos were accepted but the camera never said finished; left after 30 s (as GradeIQ's /v2 does)
 * skipped     — the customer tapped "Continue without photos" (the store never connected / stalled)
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

/** Where a resumed check should land. */
export function resumeStep(st: CheckState, supportedIds: string[]): "welcome" | "questions" | "runner" | "done" {
  if (!st.consentAt) return "welcome";
  if (!st.declared) return "questions";
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
