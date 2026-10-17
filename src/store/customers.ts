// "Find by mobile" on New trade-in (docs/TWO-PASS-CAMERA.md in the server repo):
// the advisor types the customer's mobile FIRST; at 10 digits the app asks
// GET /api/customers?phone=<10 digits> and a returning customer's name fills in,
// with their earlier trade-ins. No runtime imports — node --test runs it.
//
// Server answer: { customer: { name, phone } | null,
//                  history: [{ caseId, ref, status, storeName, device, createdAt }] }
// newest first, at most 10, same organisation only. Anything unreadable is treated
// as "no match" — the advisor just types the name, exactly as before.

/** Indian mobile: 10 digits starting 6–9, with an optional +91 / 0 in front. Empty is fine. */
export function normaliseMobile(input: string): { ok: true; value: string | null } | { ok: false } {
  const digits = input.replace(/[\s\-().]/g, "");
  if (!digits) return { ok: true, value: null };
  const m = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(digits);
  return m ? { ok: true, value: m[1] } : { ok: false };
}

export type PastTradeIn = { caseId: string; ref: string; status: string; storeName: string | null; device: string | null; createdAt: string | null };

export type CustomerLookup = { customer: { name: string; phone: string } | null; history: PastTradeIn[] };

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);

/** A device may come back as a label or as { label | model | brand… } — keep only words we can show. */
function deviceLabel(x: unknown): string | null {
  const s = str(x);
  if (s) return s;
  const o = obj(x);
  if (!o) return null;
  return str(o.label) ?? ([str(o.brand), str(o.model) ?? str(o.modelName)].filter(Boolean).join(" ") || null);
}

/** GET /api/customers answer → what the screen shows. null = not the shape we expect (show the name field). */
export function readCustomerLookup(raw: unknown): CustomerLookup | null {
  const o = obj(raw);
  if (!o || !("customer" in o)) return null;
  const c = obj(o.customer);
  const name = str(c?.name);
  const history = (Array.isArray(o.history) ? o.history : [])
    .map((h): PastTradeIn | null => {
      const x = obj(h);
      const caseId = str(x?.caseId);
      const ref = str(x?.ref);
      if (!x || !caseId || !ref) return null;
      return { caseId, ref, status: str(x.status) ?? "", storeName: str(x.storeName), device: deviceLabel(x.device), createdAt: str(x.createdAt) };
    })
    .filter((h): h is PastTradeIn => !!h);
  return { customer: name ? { name, phone: str(c?.phone) ?? "" } : null, history };
}

/** The server's case statuses, in the desk's own words (lib/domain/lifecycle.ts CASE_STATUS_LABEL). */
const CASE_STATUS: Record<string, string> = {
  draft: "Assessing",
  quoted: "Quoted",
  repair_chosen: "Chose repair",
  walked_away: "Walked away",
  locked: "Traded in · at store",
  cancelled: "Cancelled",
  in_pickup: "Awaiting pickup",
  collected: "Collected",
  cleared: "Cleared",
  regraded: "Regraded",
  rejected: "Rejected",
  not_received: "Not received",
};

/** "SU-AND-00010 · Galaxy S22 · Quoted · 12 Oct 2026 · Andheri". */
export function pastTradeInLine(h: PastTradeIn): string {
  const t = h.createdAt ? Date.parse(h.createdAt) : NaN;
  const when = Number.isFinite(t) ? new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;
  return [h.ref, h.device, CASE_STATUS[h.status] ?? (h.status ? h.status.replace(/_/g, " ") : null), when, h.storeName].filter(Boolean).join(" · ");
}
