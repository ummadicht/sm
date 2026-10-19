// The trade-in PRICE card, as BUY vs SELL (owner, 2026-10-17 — DESIGN.md "FINAL owner decisions"):
//
//   Buy    = case.quote.amount          the market price: what the store pays (the customer also gets the programme's SwapUp premium)
//   Refurb = the advisor's refurb cost (case.refurbCost, PATCH { refurbCost: { amount } }); starts
//            from SwapUp's repair estimate at list price (case.repair.listTotal), ₹0 with nothing
//            to repair. It is the STORE's figure: saving it re-asks nobody and moves no price.
//   Sell   = case.marketSell.amount     PriceIQ's refurbished-market price less 2–5% (5% up to
//            ₹15k, 4% to ₹30k, 3% to ₹50k, 2% above); when PriceIQ has none, the partner's price
//            for the phone repaired (case.repairedQuote.amount)
//   Margin = Sell − Buy − Refurb        red when negative
//
// A missing number is null with the reason why — never a guess, never a 0 standing in. Prices come
// from PriceIQ, the partner's rate card or a quote staff type in; with none: NO_MARKET_PRICE.
// PriceIQ's data carries its age (owner, 2026-10-18): older than 14 days it is shown WITH its age,
// older than 90 days it is no price at all.
// Shapes: ~/projects/swapup lib/server/cases.ts CaseView and lib/domain/buySell.ts (the
// reference); MOBILE-API.md §3b. No React Native imports: the test runs under plain node.

/** The server's ceiling for a refurb cost (lib/server/cases.ts updateCase), in rupees. */
export const REFURB_MAX = 500_000;
/** Case statuses the server still lets the counter edit (lib/server/cases.ts EDITABLE). */
const EDITABLE = new Set(["draft", "quoted"]);

/**
 * `legacyMadeUp`: an older server's quote off its built-in placeholder rate card (source kind
 * "sample" — a server not yet upgraded, or rolled back). Such a figure is never a price: it is
 * used neither as the buy price nor as the sell price, and its reason text is not shown either.
 */
type Quote = { status: string; amount: number | null; reason: string | null; legacyMadeUp: boolean };

/** The one line for "no price from anywhere" — the same words as the desk (owner, 2026-10-18). */
export const NO_MARKET_PRICE = "No market price yet — enter a quote.";
/** PriceIQ data older than this many days is shown with its age. */
export const STALE_AFTER_DAYS = 14;
/** PriceIQ data older than this many days sets no price at all. */
export const NO_PRICE_AFTER_DAYS = 90;

/**
 * PriceIQ's sell price for the phone, or why there is none (CaseView.marketSell, ~/projects/swapup
 * lib/domain/marketSell.ts).
 *   week     PriceIQ's data week ("2026-W35"); "" from a server that doesn't say
 *   ageDays  how old that data is, in whole days; null from an older server
 *   stale    over STALE_AFTER_DAYS old (the server's flag, or ageDays)
 *   note     the server's own sentence about the data — its age, and/or "PriceIQ unreachable, last
 *            answer …" while it uses its last good answer — shown as sent; null when it sends none
 */
export type MarketSell =
  | {
      amount: number;
      listing: number;
      markdownBp: number;
      grade: string;
      gradeWanted: string;
      week: string;
      ageDays: number | null;
      stale: boolean;
      note: string | null;
      why: null;
    }
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

/** A number on the card, or null with why. `note` may also qualify a number that is there (the server's word on PriceIQ's data). */
export type Figure = { amount: number | null; note: string | null };

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);
const money = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

function readQuote(x: unknown): Quote | null {
  const o = obj(x);
  if (!o || typeof o.status !== "string") return null;
  return { status: o.status, amount: money(o.amount), reason: str(o.reason), legacyMadeUp: obj(o.source)?.kind === "sample" };
}

function readMarket(x: unknown): MarketSell {
  const o = obj(x);
  if (!o) return { amount: null, why: null };
  const amount = money(o.amount), listing = money(o.listing), bp = money(o.markdownBp);
  if (amount !== null && listing !== null && bp !== null) {
    const days = money(o.ageDays);
    const ageDays = days !== null && days >= 0 ? Math.floor(days) : null;
    // Too old to price, whatever a server sent: no price, never a guess.
    if (ageDays !== null && ageDays > NO_PRICE_AFTER_DAYS) return { amount: null, why: NO_MARKET_PRICE };
    return {
      amount,
      listing,
      markdownBp: bp,
      grade: str(o.grade) ?? "",
      gradeWanted: str(o.gradeWanted) ?? str(o.grade) ?? "",
      week: str(o.week) ?? "",
      ageDays,
      stale: o.stale === true || (ageDays !== null && ageDays > STALE_AFTER_DAYS),
      note: str(o.note)?.trim() ?? null,
      why: null,
    };
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
  if (!c.device) return "No quote — model missing.";
  if (!c.device.variant) return "No quote — storage missing.";
  if (!c.hasCondition) return "No quote — condition missing.";
  if (c.conditionProblems.length) return `No quote — ${c.conditionProblems[0]}`;
  return "No quote — finish the phone's details.";
}

/**
 * BUY: the case's trade-in — what the store pays the customer. A note only says why there is no
 * number: an expired quote, or PriceIQ's age, is said once, on the answer's trade-in tile. An
 * older server's placeholder-card quote is no number at all (the same rule as SELL), so no margin
 * is ever worked out from it.
 */
export function buyFigure(c: CasePrice): Figure {
  const q = c.quote;
  if (!q) return { amount: null, note: noQuoteWhy(c) };
  if (q.legacyMadeUp) return { amount: null, note: NO_MARKET_PRICE };
  if (q.status !== "priced" || q.amount === null) return { amount: null, note: q.reason ?? NO_MARKET_PRICE };
  return { amount: q.amount, note: null };
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** "52 days old", "1 day old". */
export const ageWords = (days: number) => `${days} ${days === 1 ? "day" : "days"} old`;

/**
 * The line under a PriceIQ sell price — the server's trade-in line's words for the same base:
 * "Refurbished market price ₹53,499 (Superb) − 2% · PriceIQ 2026-W35", then ", 52 days old" when
 * the data is stale and the server sent no note saying so, then " · none at Superb" when the market
 * listed none at the phone's grade and a lower one was used. The age is said once: in the server's
 * note when it sends one (shown under the line), else here.
 */
export function marketLine(m: Extract<MarketSell, { amount: number }>): string {
  const grade = m.grade ? ` (${m.grade})` : "";
  const week = m.week ? ` ${m.week}` : "";
  const age = !m.stale || m.note ? "" : `, ${m.ageDays !== null ? ageWords(m.ageDays) : `over ${STALE_AFTER_DAYS} days old`}`;
  const lower = m.gradeWanted && m.grade && m.gradeWanted !== m.grade ? ` · none at ${m.gradeWanted}` : "";
  return `Refurbished market price ${rupees(m.listing)}${grade} − ${m.markdownBp / 100}% · PriceIQ${week}${age}${lower}`;
}

/** SELL: PriceIQ's refurbished-market price less the markdown; else the partner's repaired price. `source` says which. */
export function sellFigure(c: CasePrice): Figure & { source: string | null } {
  const m = c.market;
  if (m.amount !== null) return { amount: m.amount, note: m.note, source: marketLine(m) };
  const r = c.repairedQuote;
  if (r && r.status === "priced" && r.amount !== null && !r.legacyMadeUp) {
    return { amount: r.amount, note: null, source: "Partner's repaired price" };
  }
  if (m.why) return { amount: null, note: m.why, source: null };
  if (!c.quote) return { amount: null, note: noQuoteWhy(c), source: null };
  return { amount: null, note: (r && !r.legacyMadeUp ? r.reason : null) ?? NO_MARKET_PRICE, source: null };
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
  // The desk's own words (lib/domain/buySell.ts), so the two apps say the same thing.
  if (r?.status === "needs_inspection") return { amount: null, saved: false, note: "Needs a bench diagnosis — enter the refurb cost." };
  if (r?.status === "unpriced") return { amount: null, saved: false, note: "A part has no price — enter the refurb cost." };
  return { amount: null, saved: false, note: c.repairNotServiced ?? "No repair estimate — enter the refurb cost." };
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
  return EDITABLE.has(c.status) ? null : "Past the counter — read-only.";
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
