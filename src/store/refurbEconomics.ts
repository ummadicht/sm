// REFURB DECISION · STAFF ONLY (Linear SUP-92; owner, 2026-10-22: "staff refurb decision", the
// post-repair value from the PRICE LIST's grade price). The server works out five lines per
// trade-in, once, and sends them on the staff case as CaseView.refurbEconomics
// (~/projects/swapup lib/domain/refurbEconomics.ts, docs/MOBILE-API.md §3b). The desk
// (components/counter/RefurbDecision.tsx) and this app print them AS SENT, in the same order and
// under the same labels:
//
//   Pre-refurb value   M, the market price for the phone as it is (the case's trade-in quote)
//   Repair cost        the store's own figure, else SwapUp's repair estimate, else "Nothing to repair"
//   Post-repair value  the same rate card's price for the phone with its faults repaired
//   Repair uplift      post-repair − pre-refurb − repair cost, said as the decision ("Repair before
//                      pickup: +₹1,864" / "Send as-is — repairing costs ₹732 more than it adds")
//   SwapUp offer       what we pay, "+ ₹4,649 bonus with the Galaxy S26 Ultra 256GB"
//
// It replaced the "Store margin" card (buy / refurb / sell / margin, with PriceIQ's sell price):
// nothing is worked out here — every figure, and every reason one is missing, is the server's.
// A server that doesn't send the field (older than SUP-92), or sends one that doesn't read, shows
// no panel at all: never half the numbers. The one thing the app adds is the store's own repair
// cost box (PATCH { refurbCost: { amount } }) — the STORE's figure, which moves no price; the
// server answers with the whole case and its new lines.
// No React Native imports: the test runs under plain node.

/** The server's ceiling for the store's repair cost (lib/server/cases.ts updateCase), in rupees. */
export const REFURB_MAX = 500_000;
/** Case statuses the server still lets the counter edit (lib/server/cases.ts EDITABLE). */
const EDITABLE = new Set(["draft", "quoted"]);
/** Statuses past the counter: the desk shows no panel for them (CaseWorkspace lockedOrLater). */
const AT_OR_ENDED_AT_COUNTER = new Set(["draft", "quoted", "repair_chosen", "walked_away"]);

/** The panel's title and its labels — the desk's words, in the desk's order. */
export const TITLE = "Refurb decision · staff only";
export const LABEL = {
  preRefurb: "Pre-refurb value",
  repairCost: "Repair cost",
  postRepair: "Post-repair value",
  uplift: "Repair uplift · post-repair − pre-refurb − repair cost",
  offer: "SwapUp offer",
} as const;
export const ORDER = ["preRefurb", "repairCost", "postRepair", "uplift", "offer"] as const;
/** Before the repair cost box (the desk's "Store's own ₹"; the box carries its own ₹). */
export const OWN_COST = "Store's own";

export type Grade = "A" | "B" | "C" | "D";
/** One figure, where it came from, or why there is none (the server sets one of the two). */
export type Line = { amount: number | null; source: string | null; why: string | null };

export type RefurbEconomics = {
  preRefurb: Line & { grade: Grade | null };
  /** store = the store's own figure; estimate = SwapUp's repair estimate; none = nothing to repair (₹0); null = no figure. */
  repairCost: Line & { basis: "store" | "estimate" | "none" | null };
  postRepair: Line & { grade: Grade | null };
  /** `text` is the decision, word for word, with its own figure; `why` says what it needs when there is none. */
  uplift: { amount: number | null; verdict: "repair" | "as_is" | "nothing_to_repair" | null; text: string | null; why: string | null };
  offer: Line & { bonus: number | null; newPhone: string | null };
};

/** What the answer screen draws: the server's lines, and whether the store may still change its repair cost. */
export type RefurbDecision = { lines: RefurbEconomics; editable: boolean };

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const BAD = Symbol("bad");
/** A string, or null; anything else doesn't read. */
const text = (x: unknown): string | null | typeof BAD => (x === null || x === undefined ? null : typeof x === "string" ? (x.trim() ? x : null) : BAD);
/** Whole rupees or null; anything else doesn't read. */
const rupees = (x: unknown): number | null | typeof BAD => (x === null || x === undefined ? null : typeof x === "number" && Number.isFinite(x) ? x : BAD);
function oneOf<T extends string>(x: unknown, allowed: readonly T[]): T | null {
  return typeof x === "string" && (allowed as readonly string[]).includes(x) ? (x as T) : null;
}
const GRADES = ["A", "B", "C", "D"] as const;
const BASES = ["store", "estimate", "none"] as const;
const VERDICTS = ["repair", "as_is", "nothing_to_repair"] as const;

function readLine(x: unknown): Line | null {
  const o = obj(x);
  if (!o) return null;
  const amount = rupees(o.amount), source = text(o.source), why = text(o.why);
  if (amount === BAD || source === BAD || why === BAD) return null;
  return { amount, source, why };
}

/** CaseView.refurbEconomics, or null when it is absent (an older server, the partner) or doesn't read as all five lines. */
export function readRefurbEconomics(x: unknown): RefurbEconomics | null {
  const o = obj(x);
  const [preO, costO, postO, offerO, u] = [o?.preRefurb, o?.repairCost, o?.postRepair, o?.offer, o?.uplift].map(obj);
  const pre = readLine(preO), cost = readLine(costO), post = readLine(postO), offer = readLine(offerO);
  if (!pre || !cost || !post || !offer || !u || !preO || !costO || !postO || !offerO) return null;
  const uAmount = rupees(u.amount), uText = text(u.text), uWhy = text(u.why), bonus = rupees(offerO.bonus), phone = text(offerO.newPhone);
  if (uAmount === BAD || uText === BAD || uWhy === BAD || bonus === BAD || phone === BAD) return null;
  return {
    preRefurb: { ...pre, grade: oneOf(preO.grade, GRADES) },
    repairCost: { ...cost, basis: oneOf(costO.basis, BASES) },
    postRepair: { ...post, grade: oneOf(postO.grade, GRADES) },
    uplift: { amount: uAmount, verdict: oneOf(u.verdict, VERDICTS), text: uText, why: uWhy },
    offer: { ...offer, bonus, newPhone: phone },
  };
}

/**
 * GET/PATCH /api/cases/<id> (or an /action answer) → the panel, or null for no panel. Shown when
 * the desk shows it: the server sent the lines, the case has a quote, and it is at the counter or
 * ended there (repair chosen, walked away) — not once the trade-in is taken.
 */
export function readRefurbDecision(x: unknown): RefurbDecision | null {
  const c = obj(x);
  if (!c || typeof c.status !== "string" || !AT_OR_ENDED_AT_COUNTER.has(c.status) || !obj(c.quote)) return null;
  const lines = readRefurbEconomics(c.refurbEconomics);
  return lines ? { lines, editable: EDITABLE.has(c.status) } : null;
}

/** The line under a figure: where it came from, or why it is missing (as the desk: source first). */
export const subLine = (l: Line): string | null => l.source ?? l.why;

/** The decision line: the server's text, else "—" (its why goes under it). */
export const decisionText = (u: RefurbEconomics["uplift"]): string => u.text ?? "—";

// ── the store's own repair cost (PATCH { refurbCost }) ──────────────────────────

/** The box's first text: the repair cost line's figure, or empty. */
export function costText(e: RefurbEconomics): string {
  return e.repairCost.amount === null ? "" : String(Math.round(e.repairCost.amount));
}

/** What the box keeps while typing: digits and a point (so "3200.50" can be refused, not misread). */
export function costInput(raw: string): string {
  return raw.replace(/[^\d.]/g, "").slice(0, 9);
}

/** The typed repair cost, or why it can't be used (empty: no figure and no problem). Same bounds as the server. */
export function readCost(t: string): { amount: number | null; problem: string | null } {
  const s = t.trim();
  if (!s) return { amount: null, problem: null };
  if (!/^\d+$/.test(s)) return { amount: null, problem: "Whole rupees only." };
  const n = Number(s);
  if (n > REFURB_MAX) return { amount: null, problem: "Up to ₹5,00,000." };
  return { amount: n, problem: null };
}

/** Save is offered only for a usable figure that differs from the line's (as the desk). */
export function canSaveCost(d: RefurbDecision, t: string): boolean {
  const n = readCost(t).amount;
  return d.editable && n !== null && n !== d.lines.repairCost.amount;
}

/** PATCH /api/cases/<id> body that saves the store's own repair cost. */
export function costPatch(amount: number): { refurbCost: { amount: number } } {
  return { refurbCost: { amount } };
}
