// The trade-in PRICE card, as BUY vs SELL (owner, 2026-10-17 — DESIGN.md "FINAL owner decisions"):
//
//   Buy    = case.quote.amount          what the store pays the customer (the partner's as-is price)
//   Refurb = the advisor's refurb cost (case.refurbCost, PATCH { refurbCost: { amount } }); starts
//            from SwapUp's repair estimate at list price (case.repair.listTotal), ₹0 with nothing
//            to repair. It is the STORE's figure: saving it re-asks nobody and moves no price.
//   Sell   = case.marketSell.amount     PriceIQ's Cashify refurbished listing less 2–5% (5% on
//            cheaper phones, 2% on dearer ones); when PriceIQ has none, the partner's price for
//            the phone repaired (case.repairedQuote.amount)
//   Margin = Sell − Buy − Refurb        red when negative
//
// A missing number is null with the reason why — never a guess, never a 0 standing in.
// Shapes: ~/projects/swapup lib/server/cases.ts CaseView and lib/domain/buySell.ts (the
// reference); MOBILE-API.md §3b. No React Native imports: the test runs under plain node.

/** The server's ceiling for a refurb cost (lib/server/cases.ts updateCase), in rupees. */
export const REFURB_MAX = 500_000;
/** Case statuses the server still lets the counter edit (lib/server/cases.ts EDITABLE). */
const EDITABLE = new Set(["draft", "quoted"]);

type Quote = { status: string; amount: number | null; reason: string | null; sample: boolean };

/** PriceIQ's sell price for the phone, or why there is none. */
export type MarketSell =
  | { amount: number; listing: number; markdownBp: number; grade: string; gradeWanted: string; week: string; why: null }
  | { amount: null; why: string | null };

/** The parts of CaseView this card reads. */
export type CasePrice = {
  id: string;
  ref: string;
  status: string;
  /** null = no model on the case yet. */
  device: { variant: string | null } | null;
  hasCondition: boolean;
  conditionProblems: string[];
  faultCount: number;
  quoteBlocked: string | null;
  quote: Quote | null;
  quoteExpired: boolean;
  repairedQuote: Quote | null;
  repair: { status: string; customerPays: number | null; listTotal: number | null } | null;
  refurbCost: { amount: number; by: string } | null;
  market: MarketSell;
  repairNotServiced: string | null;
};

/** A number on the card, or null with why. `note` may also qualify a number that is there (expired, sample, source). */
export type Figure = { amount: number | null; note: string | null };

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);
const money = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

function readQuote(x: unknown): Quote | null {
  const o = obj(x);
  if (!o || typeof o.status !== "string") return null;
  return { status: o.status, amount: money(o.amount), reason: str(o.reason), sample: obj(o.source)?.kind === "sample" };
}

function readMarket(x: unknown): MarketSell {
  const o = obj(x);
  if (!o) return { amount: null, why: null };
  const amount = money(o.amount), listing = money(o.listing), bp = money(o.markdownBp);
  if (amount !== null && listing !== null && bp !== null) {
    return { amount, listing, markdownBp: bp, grade: str(o.grade) ?? "", gradeWanted: str(o.gradeWanted) ?? str(o.grade) ?? "", week: str(o.week) ?? "", why: null };
  }
  return { amount: null, why: str(o.why) };
}

/** GET/PATCH /api/cases/<id>, or null when the answer isn't a case. */
export function readCasePrice(x: unknown): CasePrice | null {
  const o = obj(x);
  if (!o || typeof o.id !== "string" || typeof o.status !== "string") return null;
  const dev = obj(o.device);
  const rep = obj(o.repair);
  const rc = obj(o.refurbCost);
  const rcAmount = rc ? money(rc.amount) : null;
  return {
    id: o.id,
    ref: typeof o.ref === "string" ? o.ref : "",
    status: o.status,
    device: dev ? { variant: str(dev.variant) } : null,
    hasCondition: !!obj(o.condition),
    conditionProblems: Array.isArray(o.conditionProblems) ? o.conditionProblems.filter((p): p is string => typeof p === "string" && !!p.trim()) : [],
    faultCount: Array.isArray(o.faults) ? o.faults.length : 0,
    quoteBlocked: str(o.quoteBlocked),
    quote: readQuote(o.quote),
    quoteExpired: o.quoteExpired === true,
    repairedQuote: readQuote(o.repairedQuote),
    repair: rep && typeof rep.status === "string" ? { status: rep.status, customerPays: money(rep.customerPays), listTotal: money(rep.listTotal) } : null,
    refurbCost: rcAmount !== null ? { amount: rcAmount, by: str(rc!.by) ?? "" } : null,
    market: readMarket(o.marketSell),
    repairNotServiced: str(o.repairNotServiced),
  };
}

/** Why the case has no partner quote at all — the server's own reasons, in its order (reprice()). */
function noQuoteWhy(c: CasePrice): string {
  if (c.quoteBlocked) return c.quoteBlocked;
  if (!c.device) return "No quote yet — the phone's model isn't on the case.";
  if (!c.device.variant) return "No quote yet — the storage size isn't on the case.";
  if (!c.hasCondition) return "No quote yet — the phone's condition isn't on the case.";
  if (c.conditionProblems.length) return `No quote yet — ${c.conditionProblems[0]}`;
  return "No quote yet — finish describing the phone on the case.";
}

/** BUY: the partner's as-is price — what the store pays the customer. */
export function buyFigure(c: CasePrice): Figure {
  const q = c.quote;
  if (!q) return { amount: null, note: noQuoteWhy(c) };
  if (q.status !== "priced" || q.amount === null) return { amount: null, note: q.reason ?? "The partner has no price for this phone." };
  if (c.quoteExpired) return { amount: q.amount, note: "Quote expired — re-quote on the case." };
  return { amount: q.amount, note: q.sample ? "Sample price, not a real quote." : null };
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** SELL: PriceIQ's Cashify refurbished listing less the markdown; else the partner's repaired price. `source` says which. */
export function sellFigure(c: CasePrice): Figure & { source: string | null } {
  const m = c.market;
  if (m.amount !== null) {
    const lower = m.gradeWanted && m.gradeWanted !== m.grade ? ` · none at ${m.gradeWanted}` : "";
    return { amount: m.amount, note: null, source: `Cashify ${m.grade} ${rupees(m.listing)} − ${m.markdownBp / 100}%${lower}` };
  }
  const r = c.repairedQuote;
  if (r && r.status === "priced" && r.amount !== null) {
    return { amount: r.amount, note: r.sample ? "Sample price, not a real quote." : null, source: "Partner's repaired price" };
  }
  if (m.why) return { amount: null, note: m.why, source: null };
  if (!c.quote) return { amount: null, note: noQuoteWhy(c), source: null };
  return { amount: null, note: r?.reason ?? "No repaired price from the partner.", source: null };
}

/**
 * Where the refurb box starts: the figure saved on the case (`saved`), else SwapUp's repair
 * estimate at list price (what the parts and labour cost, even when the customer's cover pays),
 * else ₹0 when there is nothing to repair, else empty with why.
 */
export function refurbStart(c: CasePrice): Figure & { saved: boolean } {
  if (c.refurbCost) return { amount: c.refurbCost.amount, saved: true, note: c.refurbCost.by ? `Saved by ${c.refurbCost.by}.` : "Saved on the case." };
  const r = c.repair;
  if (r?.status === "quoted") {
    const est = r.listTotal ?? r.customerPays;
    if (est !== null) return { amount: est, saved: false, note: "SwapUp's repair estimate." };
  }
  if (c.faultCount === 0 || r?.status === "nothing_to_repair") return { amount: 0, saved: false, note: "Nothing to repair." };
  if (r?.status === "needs_inspection") return { amount: null, saved: false, note: "Needs a look on the bench — enter your refurb cost." };
  if (r?.status === "unpriced") return { amount: null, saved: false, note: "No repair price for this phone — enter your refurb cost." };
  return { amount: null, saved: false, note: c.repairNotServiced ?? "No repair estimate yet — enter your refurb cost." };
}

/** What the refurb box keeps while typing: digits and a point (so "3200.50" can be refused, not misread). */
export function refurbInput(raw: string): string {
  return raw.replace(/[^\d.]/g, "").slice(0, 9);
}

/** The typed refurb cost, or why it can't be used. Same bounds as the server. */
export function readRefurb(text: string): { amount: number | null; problem: string | null } {
  const t = text.trim();
  if (!t) return { amount: null, problem: "Enter the refurb cost." };
  if (!/^\d+$/.test(t)) return { amount: null, problem: "Whole rupees only." };
  const n = Number(t);
  if (n > REFURB_MAX) return { amount: null, problem: "Up to ₹5,00,000." };
  return { amount: n, problem: null };
}

/** MARGIN = Sell − Buy − Refurb, or null naming what is missing. */
export function marginFigure(buy: number | null, refurb: number | null, sell: number | null): Figure {
  if (buy !== null && refurb !== null && sell !== null) return { amount: sell - buy - refurb, note: null };
  const missing = [buy === null && "the buy price", refurb === null && "the refurb cost", sell === null && "the sell price"].filter((x): x is string => !!x);
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return { amount: null, note: `Needs ${list}.` };
}

/** null while the counter may still change the case; else why the refurb cost is read-only. */
export function refurbLocked(c: CasePrice): string | null {
  return EDITABLE.has(c.status) ? null : "The trade-in is past the counter — the refurb cost can't change here.";
}

/** PATCH /api/cases/<id> body that saves the advisor's figure. */
export function refurbPatch(amount: number): { refurbCost: { amount: number } } {
  return { refurbCost: { amount } };
}

export type PriceCardModel = {
  buy: Figure;
  sell: Figure & { source: string | null };
  start: Figure & { saved: boolean };
  /** The typed refurb cost (or why it can't be used). */
  refurb: { amount: number | null; problem: string | null };
  margin: Figure;
  locked: string | null;
  /** The box holds a usable number that differs from where it started — only then is Save offered. */
  canSave: boolean;
};

/** Everything the card shows, from the case and what is in the refurb box. */
export function priceCard(c: CasePrice, refurbText: string): PriceCardModel {
  const buy = buyFigure(c);
  const sell = sellFigure(c);
  const start = refurbStart(c);
  const refurb = readRefurb(refurbText);
  const locked = refurbLocked(c);
  const canSave = !locked && refurb.amount !== null && refurb.amount !== start.amount;
  return { buy, sell, start, refurb, margin: marginFigure(buy.amount, refurb.amount, sell.amount), locked, canSave };
}

/**
 * The line under the refurb box. Read-only says why; a typed number that can't be used says
 * why in red; an empty box says why there is no figure; the starting figure keeps its own note
 * (estimate / saved / nothing to repair); any other number is simply not saved yet.
 */
export function refurbHint(c: CasePrice, text: string): { text: string; bad: boolean } | null {
  const locked = refurbLocked(c);
  if (locked) return { text: locked, bad: false };
  const start = refurbStart(c);
  const typed = readRefurb(text);
  if (!text.trim()) return { text: start.amount === null && start.note ? start.note : "Enter the refurb cost.", bad: false };
  if (typed.problem) return { text: typed.problem, bad: true };
  if (typed.amount === start.amount) return start.note ? { text: start.note, bad: false } : null;
  return { text: "Not saved yet.", bad: false };
}

/** The refurb box's first text: the starting figure, or empty. */
export function refurbText(c: CasePrice): string {
  const a = refurbStart(c).amount;
  return a === null ? "" : String(Math.round(a));
}
