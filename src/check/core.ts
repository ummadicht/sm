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
  isPhysicalDevice: boolean;
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
};

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
