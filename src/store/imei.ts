// IMEI FIRST (owner, 2026-10-19: "Scan IMEI first ... by *#06#"; the GSMA blacklist "once per
// trade-in"). The store app's rules for the first card of a trade-in — the same card tops New
// trade-in, the Session screen of a customer-started test, and Take the trade-in when the case
// still has no IMEI (./screens/ImeiCard.tsx):
//   - imeisIn / takeScan   what a barcode on the *#06# screen (or the box) says: a 15-digit run that
//                          passes the IMEI check digit; a second distinct one is IMEI 2.
//   - readImeiRead         POST /api/imei/read — the SwapUp server has GradeIQ read a photo of the
//                          screen. Shown as "Read: … — confirm", never trusted by itself.
//   - readImeiLookup, readKymEarly, imeiResult, imeiStop
//                          what the server found once the IMEI was saved (the model from its TAC, the
//                          GSMA blacklist, an IMEI already on another trade-in) and the government
//                          check (KYM, SMS to 14422) recorded early, in the card's words.
//   - startTradeIn         Start: POST /api/cases → PATCH {imei, imei2} → stop when the phone is
//                          blacklisted → POST /api/test-sessions {caseId}. With the IMEI skipped
//                          ("scan at hand-over"), today's one call.
// Contract: ~/projects/swapup docs/MOBILE-API.md (IMEI first). GSMA does NOT replace KYM: Take the
// trade-in still needs the government check "clear", and only pre-fills it from kymEarly.
// No React Native imports: the test runs under plain node (./imei.test.ts).
import type { BarcodeType } from "expo-camera";
import { ApiError } from "../shared/api";
import { KYM, type Kym } from "./lock";
import { imeiCheck } from "./phoneLed";
import { type StaffClient, errText } from "./staffClient";
import type { SessionLinks } from "./types";

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);

// ── the scan ─────────────────────────────────────────────────────────────────

/** The barcodes a *#06# screen or a box label carries an IMEI in (GradeIQ's scanner reads the same). */
export const IMEI_BARCODE_TYPES = ["code128", "code39", "ean13", "itf14", "datamatrix", "qr"] as const satisfies readonly BarcodeType[];

/**
 * The IMEIs in one barcode's text, at most two, in order. GradeIQ's rule (ImeiScanner.tsx
 * extractImei): screen barcodes flicker, so only a 15-digit run that passes the check digit is
 * taken. Digits split by spaces or dashes ("35-678901-234567-8") count as one run when the text holds
 * nothing longer. A run longer than 15 digits (an EID is 32, an IMEISV 16) is never slid along: about
 * one 15-digit window in ten passes the check digit by chance.
 */
export function imeisIn(text: string): string[] {
  const out: string[] = [];
  const add = (d: string) => {
    if (d.length === 15 && imeiCheck(d) === "ok" && !out.includes(d) && out.length < 2) out.push(d);
  };
  const runs = String(text ?? "").match(/\d+/g) ?? [];
  for (const r of runs) add(r);
  if (!out.length && !runs.some((r) => r.length > 15)) add(runs.join(""));
  return out;
}

/** What the camera has read so far. */
export type Scanned = { imei: string | null; imei2: string | null };
export const NOTHING_SCANNED: Scanned = { imei: null, imei2: null };

/** Said while nothing is found yet and the camera reads a code with no IMEI in it (a serial, an EAN). */
export const NOT_AN_IMEI = "Not an IMEI — scan the one labelled IMEI.";

/**
 * One barcode the camera read, added to what it read before: the first IMEI is IMEI 1, a second
 * distinct one IMEI 2 (a dual-SIM phone's *#06# shows both); `next` is `s` itself when nothing changed.
 * `note` only while nothing is found: once IMEI 1 is in, the serial and EID barcodes beside IMEI 2 are
 * expected and say nothing.
 */
export function takeScan(s: Scanned, text: string): { next: Scanned; note: string | null } {
  const found = imeisIn(text);
  if (!found.length) return { next: s, note: s.imei ? null : NOT_AN_IMEI };
  let { imei, imei2 } = s;
  for (const x of found) {
    if (!imei) imei = x;
    else if (x !== imei && !imei2) imei2 = x;
  }
  // The same code seen again (the camera reads it many times a second): the same object, nothing to redraw.
  return { next: imei === s.imei && imei2 === s.imei2 ? s : { imei, imei2 }, note: null };
}

/**
 * The PATCH /api/cases/<id> body for a captured IMEI. IMEI 2 only when there is one: a null would wipe
 * an IMEI 2 another path recorded (Apply copies the phone's own).
 */
export function imeiPatch(v: { imei: string; imei2: string | null }): { imei: string; imei2?: string } {
  return v.imei2 ? { imei: v.imei, imei2: v.imei2 } : { imei: v.imei };
}

/** After IMEI 1, how long the camera keeps looking for IMEI 2 before it closes by itself. */
export const IMEI2_WAIT_MS = 3_000;

// ── "Read the screen" (POST /api/imei/read) ─────────────────────────────────

/** The server waits up to ~20 s for GradeIQ's reader; the app waits a little longer. */
export const IMEI_READ_MS = 30_000;
/** PATCH {imei} resolves the IMEI before it answers (≤ 10 s on the server). */
export const IMEI_SAVE_MS = 25_000;

/** What the reader saw. `valid`: IMEI 1 passes its check digit. IMEI 2 only when it does too. */
export type ImeiRead = { imei: string; imei2: string | null; valid: boolean };

/** The server's 200 answer {imei, imei2, valid}, or null (no IMEI in it). The check digit is checked here again. */
export function readImeiRead(x: unknown): ImeiRead | null {
  const o = obj(x);
  const imei = str(o?.imei)?.replace(/\D/g, "") ?? "";
  if (!imei) return null;
  const two = str(o?.imei2)?.replace(/\D/g, "") ?? "";
  return {
    imei: imei.slice(0, 15),
    imei2: two && two !== imei && imeiCheck(two) === "ok" ? two : null,
    valid: imeiCheck(imei) === "ok",
  };
}

/** Said when the server answers 200 with no IMEI (its 422 says the same in its own words). */
export const NOTHING_READ = "No IMEI found in that photo — try again or type it.";
/** The server's 503 sentence, said too by a server that has no reader yet (404). */
export const READER_OFF = "The screen reader is off — scan or type the IMEI.";

/** What a failed read says: the server's own sentence, or READER_OFF from a server without the route. */
export function readFailText(e: unknown): string {
  return e instanceof ApiError && e.status === 404 ? READER_OFF : errText(e);
}

// ── what the server found (CaseView.imeiLookup / imeiWarnings / kymEarly) ────

export type Blacklist = "clean" | "blacklisted" | "unknown";
const BLACKLISTS = ["clean", "blacklisted", "unknown"] as const;

/** GradeIQ's lookup for the case's IMEI, once per case (null for a partner, or before an IMEI). */
export type ImeiLookup = { brand: string | null; model: string | null; modelNumber: string | null; blacklist: Blacklist; source: string; at: string };

/** The government IMEI check (KYM) answered before the tests; Take the trade-in starts from it. */
export type KymEarly = { status: Kym; reference: string | null };

/** CaseView.imeiLookup, or null. A blacklist word it doesn't know reads as "unknown" — never as clean. */
export function readImeiLookup(x: unknown): ImeiLookup | null {
  const o = obj(x);
  if (!o) return null;
  const b = typeof o.blacklist === "string" && (BLACKLISTS as readonly string[]).includes(o.blacklist) ? (o.blacklist as Blacklist) : "unknown";
  return { brand: str(o.brand), model: str(o.model), modelNumber: str(o.modelNumber), blacklist: b, source: str(o.source) ?? "", at: str(o.at) ?? "" };
}

/** CaseView.kymEarly, or null (none recorded, or a status the app doesn't know). */
export function readKymEarly(x: unknown): KymEarly | null {
  const o = obj(x);
  const status = KYM.find((k) => k.id === o?.status)?.id ?? null;
  return o && status ? { status, reference: str(o.reference) } : null;
}

/** The GSMA lookup's word on the IMEI. "unknown" is never said as clean. */
export const BLACKLIST_TEXT: Record<Blacklist, string> = {
  clean: "not blacklisted (GSMA)",
  unknown: "Blacklist not checked",
  blacklisted: "reported lost or stolen (GSMA)",
};

/** The owner's sentences when the trade-in stops before the tests: GSMA's register, or the government check. */
export const STOP_GSMA = "This phone is reported lost or stolen (GSMA). It can't be traded in.";
export const STOP_BLACKLISTED = "This phone is reported lost or stolen. It can't be traded in.";

type ImeiHead = { imeiLookup: ImeiLookup | null; kymEarly: KymEarly | null };

/** Why the trade-in stops here, or null: GSMA says blacklisted, or the early KYM answer is anything but clear. */
export function imeiStop(h: ImeiHead): string | null {
  if (h.imeiLookup?.blacklist === "blacklisted") return STOP_GSMA;
  if (h.kymEarly && h.kymEarly.status !== "clear") return STOP_BLACKLISTED;
  return null;
}

/** "Galaxy S23 Ultra · not blacklisted (GSMA)"; null before the server has looked the IMEI up. */
export function imeiResultLine(lookup: ImeiLookup | null): string | null {
  if (!lookup) return null;
  const name = lookup.model ?? lookup.brand;
  const said = BLACKLIST_TEXT[lookup.blacklist];
  return name ? `${name} · ${said}` : said.charAt(0).toUpperCase() + said.slice(1);
}

// ── Start ────────────────────────────────────────────────────────────────────

export type StartInput = {
  customerName: string;
  /** 10 digits, or null when not given. */
  customerPhone: string | null;
  /** null = skipped: the IMEI is taken at hand-over. */
  imei: Scanned | null;
  /** The case a failed or stopped Start already opened: never a second one for the same customer. */
  caseId: string | null;
};

export type StartOutcome =
  | { kind: "started"; links: SessionLinks }
  /** The phone is blacklisted: no test starts. `caseView` = the PATCH's answer, when there was one. */
  | { kind: "stopped"; text: string; caseId: string | null; caseView: unknown }
  | { kind: "failed"; text: string; caseId: string | null; caseView: unknown };

function customerBody(i: StartInput): { customerName?: string; customerPhone?: string } {
  const b: { customerName?: string; customerPhone?: string } = {};
  if (i.customerName.trim()) b.customerName = i.customerName.trim();
  if (i.customerPhone) b.customerPhone = i.customerPhone;
  return b;
}

/**
 * Start. With an IMEI: open the case (unless a failed Start already did), save the IMEI — the
 * server looks it up before it answers — and stop there when the phone is blacklisted; else start
 * the test on that case. Skipped: one POST /api/test-sessions with the customer, as before. The
 * server is the judge as well: its 409 {reason: "blacklisted"} on the test stops it the same way.
 */
export async function startTradeIn(api: Pick<StaffClient, "post" | "patch">, i: StartInput): Promise<StartOutcome> {
  let caseId = i.caseId;
  let caseView: unknown = null;
  try {
    if (i.imei?.imei) {
      if (!caseId) {
        const c = obj(await api.post<unknown>("/api/cases", customerBody(i)));
        if (!c || typeof c.id !== "string") throw new Error("No case came back. Try again.");
        caseId = c.id;
      }
      caseView = await api.patch<unknown>(`/api/cases/${encodeURIComponent(caseId)}`, imeiPatch({ imei: i.imei.imei, imei2: i.imei.imei2 }), { timeoutMs: IMEI_SAVE_MS });
      const v = obj(caseView);
      const stop = imeiStop({ imeiLookup: readImeiLookup(v?.imeiLookup), kymEarly: readKymEarly(v?.kymEarly) });
      if (stop) return { kind: "stopped", text: stop, caseId, caseView };
    }
    const links = await api.post<SessionLinks>("/api/test-sessions", caseId ? { caseId } : customerBody(i));
    if (!links?.session?.id) throw new Error("No test came back. Try again.");
    return { kind: "started", links };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.reason === "blacklisted") return { kind: "stopped", text: e.message, caseId, caseView };
    return { kind: "failed", text: errText(e), caseId, caseView };
  }
}
