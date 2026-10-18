// THE ANSWER the advisor shows the customer once the test is applied (owner, 2026-10-17:
// "Why asking questions when we have all tested data ... just refurb quote vs bonus + trade in price"):
//
//   Refurb quote      = offer.repair.amount   what the CUSTOMER pays to fix this phone (the price book,
//                                              a bench/service-centre quote, or ₹0 when covered). Not the
//                                              store's refurb cost — that stays in the "Store margin" card.
//   Trade-in + bonus  = offer.swap.total      the as-is price + the upgrade bonus; offer.swap.tradeInDetail
//                                              says how the trade-in was reached (PriceIQ's refurbished-market
//                                              price at the grade less the markdown and a % per defect, the
//                                              partner's rate card, or a quote staff typed in)
//   Verdict           = offer.headline        decide()'s headline, unchanged; the bonus is never a signal
//
// The server builds every number and every reason (lib/domain/offer.ts buildOffer, carried on
// CaseView.offer — spec §3). The app never invents a reason: it reads the server's strings and
// owns only the labels below. A missing number stays null with the server's why — never a made-up
// price; with no why at all the tile says NO_MARKET_PRICE.
// Shapes: ~/projects/swapup lib/domain/offer.ts and lib/server/cases.ts CaseView; MOBILE-API.md §3c.
// The SwapUp grade (CaseView.grading, read by readCaseGrade at the bottom) sits beside the answer,
// never inside it: nothing here that prices reads it.
// No React Native imports: the test runs under plain node (./offer.test.ts).

/** Where the case's storage size came from. "customer" = typed on their phone, never measured. */
export type VariantSource = "measured" | "catalogue" | "customer" | "advisor";
/** decide()'s recommendation (lib/domain/decision.ts). */
export type Recommendation = "repair" | "upgrade" | "either" | "no_repair" | "cannot_say";
/** One storage chip: the size and its trade-in, or null when nothing prices that size. */
export type StorageOption = { variant: string; tradeIn: number | null };

/** What the answer still needs from the advisor, in the server's order. */
export type OfferAsk =
  | { kind: "blocked"; title: string; text: string }
  | { kind: "model"; title: string; text: string }
  /** `note`: the server's one line under the chips (e.g. "Refurbished market price, week 2026-W35, 52 days old."), as sent; null = none. */
  | { kind: "storage"; title: string; text: string; options: StorageOption[]; note: string | null }
  | { kind: "partner_quote"; title: string; text: string }
  | { kind: "repair_quote"; title: string; text: string }
  | { kind: "new_phone"; title: string; text: string };

export type Coverage = "none" | "warranty" | "care_plus";

/**
 * How the trade-in was reached (offer.swap.tradeInDetail, lib/domain/offer.ts):
 *   line   under the figure, PriceIQ only: "Refurbished market price ₹51,399 (Good) − 2% − 2 defects
 *          · PriceIQ 2026-W35, 52 days old" — the server's words, its data's age included when stale
 *   lines  behind "Show details": each step with its % and rupees ("Rear camera faulty", "18%", −9251)
 *   note   why PriceIQ didn't price it, when the partner's rate card or a typed quote did instead
 */
export type TradeInDetail = { line: string | null; lines: { label: string; pct: string | null; amount: number }[]; note: string | null };
export type Pick = "repair" | "swap";

export type Offer = {
  /** The case is draft or quoted — the counter can still act on it. */
  open: boolean;
  headline: string;
  /** One sentence under the headline. */
  reason: string | null;
  recommendation: Recommendation | null;
  /** repair → "repair"; upgrade | no_repair → "swap"; either | cannot_say → null. */
  recommended: Pick | null;
  asks: OfferAsk[];
  storage: { variant: string | null; source: VariantSource | null; note: string | null };
  /** THE refurb quote: what the customer pays to fix it. */
  repair: {
    amount: number | null;
    covered: boolean;
    basis: "book" | "manual" | null;
    detail: string | null;
    why: string | null;
    nothingToRepair: boolean;
    coverage: Coverage;
  };
  swap: {
    tradeIn: number | null;
    tradeInNote: string | null;
    bonus: number | null;
    bonusBp: number | null;
    bonusWhy: string | null;
    /** tradeIn + (bonus ?? 0); null when tradeIn is null. */
    total: number | null;
    /** Why tradeIn is null. */
    why: string | null;
    /** How the trade-in was reached (the server's words); null without a trade-in or from an older server. */
    tradeInDetail: TradeInDetail | null;
    newPhone: { deviceId: string; label: string; price: number; suggested: boolean; why: string | null } | null;
    /** What the customer pays for the new phone (decision.upgrade.pays). */
    customerPays: number | null;
    /** decision.upgrade.extraVsRepair: + = the swap costs the customer more today than the repair. */
    vsRepair: number | null;
  };
  /** null = allowed; a string = why not (the server's own words). */
  actions: { repair: string | null; swap: string | null; walkAway: string | null };
  signals: { text: string; points: "repair" | "upgrade"; strength: "strong" | "soft" }[];
  /** A safety warning the answer shows in the open, under its sentence (a swollen battery). */
  safety: string | null;
  caveats: string[];
};

/** The parts of CaseView the answer and lock screens read besides the offer. */
export type CaseHead = {
  id: string;
  ref: string;
  status: string;
  /** device.model, e.g. "Galaxy S23 Ultra"; null = no model on the case yet. */
  deviceLabel: string | null;
  variant: string | null;
  customerName: string | null;
  customerPhone: string | null;
  imei: string | null;
  /** The second IMEI of a dual-SIM phone (Apply copies it in): the government check covers it too. */
  imei2: string | null;
  imeiCheck: "valid" | "invalid" | null;
  imei2Check: "valid" | "invalid" | null;
  /** Why the trade-in can't be locked yet, the server's order (empty = it can). */
  lockBlockers: string[];
  variantSource: VariantSource | null;
  /** The size the phone read off its own disk at Apply, whatever the model's list says; null = it didn't measure. */
  measuredStorage: string | null;
};

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);
const money = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const oneOf = <T extends string>(x: unknown, allowed: readonly T[]): T | null => (typeof x === "string" && (allowed as readonly string[]).includes(x) ? (x as T) : null);
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && !!s.trim()) : []);

const SOURCES = ["measured", "catalogue", "customer", "advisor"] as const;
const RECOMMENDATIONS = ["repair", "upgrade", "either", "no_repair", "cannot_say"] as const;
const ASK_KINDS = ["blocked", "model", "storage", "partner_quote", "repair_quote", "new_phone"] as const;
const CHECK_RESULTS = ["valid", "invalid"] as const;

/**
 * An action field that is neither null (allowed) nor the server's reason is read as NOT allowed:
 * a half-read answer must never open a button the server would refuse. The only reason the app
 * writes itself, and it sends the advisor to the desk, where the full case says what is wrong.
 */
export const ACTION_UNKNOWN = "Do this on the full case.";

/** The contract's mapping, used only when the server didn't send `recommended`. */
function recommendedFrom(r: Recommendation | null): Pick | null {
  if (r === "repair") return "repair";
  if (r === "upgrade" || r === "no_repair") return "swap";
  return null;
}

function readAsk(x: unknown): OfferAsk | null {
  const o = obj(x);
  const kind = oneOf(o?.kind, ASK_KINDS);
  const title = str(o?.title), text = str(o?.text);
  if (!o || !kind || !title || !text) return null;
  if (kind !== "storage") return { kind, title, text };
  const options = (Array.isArray(o.options) ? o.options : [])
    .map((p) => {
      const q = obj(p);
      const variant = str(q?.variant);
      // Only the size and its price: any other flag an older server sends on a chip is ignored.
      return variant ? { variant, tradeIn: money(q?.tradeIn) } : null;
    })
    .filter((p): p is StorageOption => !!p);
  return { kind, title, text, options, note: str(o.note) };
}

function readNewPhone(x: unknown): Offer["swap"]["newPhone"] {
  const o = obj(x);
  const deviceId = str(o?.deviceId), label = str(o?.label), price = money(o?.price);
  if (!o || !deviceId || !label || price === null) return null;
  return { deviceId, label, price, suggested: o.suggested === true, why: str(o.why) };
}

/** offer.swap.tradeInDetail, or null when there is nothing to show (or it can't be read). */
export function readTradeInDetail(x: unknown): TradeInDetail | null {
  const o = obj(x);
  if (!o) return null;
  const lines = (Array.isArray(o.lines) ? o.lines : [])
    .map((l) => {
      const q = obj(l);
      const label = str(q?.label), amount = money(q?.amount);
      return label && amount !== null ? { label, pct: str(q?.pct), amount } : null;
    })
    .filter((l): l is TradeInDetail["lines"][number] => !!l);
  const line = str(o.line), note = str(o.note);
  return line || lines.length || note ? { line, lines, note } : null;
}

/** One "Show details" row's rupees: "−₹9,251"; a give-back after the first row "+₹16,048". */
export function detailAmount(amount: number, first: boolean): string {
  return amount > 0 && !first ? `+${inr(amount)}` : inr(amount);
}

function readAction(x: unknown): string | null {
  if (x === null) return null;
  return str(x) ?? ACTION_UNKNOWN;
}

/** CaseView.offer, or null when there is none (a partner viewer, an older server, junk). Never throws. */
export function readOffer(x: unknown): Offer | null {
  const o = obj(x);
  const headline = str(o?.headline);
  if (!o || !headline) return null;
  const st = obj(o.storage), rep = obj(o.repair), sw = obj(o.swap), act = obj(o.actions);
  const recommendation = oneOf(o.recommendation, RECOMMENDATIONS);
  const recommended = o.recommended === null ? null : (oneOf(o.recommended, ["repair", "swap"] as const) ?? recommendedFrom(recommendation));
  const signals = (Array.isArray(o.signals) ? o.signals : [])
    .map((s) => {
      const q = obj(s);
      const text = str(q?.text), points = oneOf(q?.points, ["repair", "upgrade"] as const), strength = oneOf(q?.strength, ["strong", "soft"] as const);
      return text && points && strength ? { text, points, strength } : null;
    })
    .filter((s): s is Offer["signals"][number] => !!s);
  return {
    open: o.open === true,
    headline,
    reason: str(o.reason),
    recommendation,
    recommended,
    asks: (Array.isArray(o.asks) ? o.asks : []).map(readAsk).filter((a): a is OfferAsk => !!a),
    storage: { variant: str(st?.variant), source: oneOf(st?.source, SOURCES), note: str(st?.note) },
    repair: {
      amount: money(rep?.amount),
      covered: rep?.covered === true,
      basis: oneOf(rep?.basis, ["book", "manual"] as const),
      detail: str(rep?.detail),
      why: str(rep?.why),
      nothingToRepair: rep?.nothingToRepair === true,
      coverage: oneOf(rep?.coverage, ["none", "warranty", "care_plus"] as const) ?? "none",
    },
    swap: {
      tradeIn: money(sw?.tradeIn),
      tradeInNote: str(sw?.tradeInNote),
      bonus: money(sw?.bonus),
      bonusBp: money(sw?.bonusBp),
      bonusWhy: str(sw?.bonusWhy),
      total: money(sw?.total),
      why: str(sw?.why),
      tradeInDetail: readTradeInDetail(sw?.tradeInDetail),
      newPhone: readNewPhone(sw?.newPhone),
      customerPays: money(sw?.customerPays),
      vsRepair: money(sw?.vsRepair),
    },
    actions: { repair: readAction(act?.repair), swap: readAction(act?.swap), walkAway: readAction(act?.walkAway) },
    signals,
    safety: str(o.safety),
    caveats: strings(o.caveats),
  };
}

/** GET/PATCH /api/cases/<id> (or any /action answer), or null when the answer isn't a case. */
export function readCaseHead(x: unknown): CaseHead | null {
  const o = obj(x);
  if (!o || typeof o.id !== "string" || typeof o.status !== "string") return null;
  const dev = obj(o.device), cust = obj(o.customer);
  return {
    id: o.id,
    ref: typeof o.ref === "string" ? o.ref : "",
    status: o.status,
    deviceLabel: str(dev?.model),
    variant: str(dev?.variant),
    customerName: str(cust?.name),
    customerPhone: str(cust?.phone),
    imei: str(o.imei),
    imei2: str(o.imei2),
    imeiCheck: oneOf(o.imeiCheck, CHECK_RESULTS),
    imei2Check: oneOf(o.imei2Check, CHECK_RESULTS),
    lockBlockers: strings(o.lockBlockers),
    variantSource: oneOf(o.variantSource, SOURCES),
    measuredStorage: str(o.measuredStorage),
  };
}

// ── what the screen shows ────────────────────────────────────────────────────

/** ₹1,23,456 — Indian digit grouping, no paise. The same rule as ui.tsx inr(), which can't be imported here (React Native). */
function inr(amount: number): string {
  const neg = amount < 0;
  const s = Math.abs(Math.round(amount)).toString();
  const out = s.length <= 3 ? s : `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${s.slice(-3)}`;
  return `${neg ? "−" : ""}₹${out}`;
}

/** The server allows this choice right now. */
export function pickAllowed(o: Offer, pick: Pick): boolean {
  return (pick === "repair" ? o.actions.repair : o.actions.swap) === null;
}

/** The tile selected when the screen opens: the recommendation if it is allowed; else swap when only swap is; else none. */
export function defaultPick(o: Offer): Pick | null {
  if (o.recommended && pickAllowed(o, o.recommended)) return o.recommended;
  if (!pickAllowed(o, "repair") && pickAllowed(o, "swap")) return "swap";
  return null;
}

/** The tile that carries the small "Recommended" label: only a repair or upgrade verdict, never "nothing to repair". */
export function recommendedBadge(o: Offer): Pick | null {
  if (o.recommendation === "repair") return "repair";
  if (o.recommendation === "upgrade") return "swap";
  return null;
}

const PILL_TITLE: Record<Pick, string> = { repair: "Customer will repair", swap: "Swap up" };
const refusal = (o: Offer, pick: Pick) => (pick === "repair" ? o.actions.repair : o.actions.swap);

/**
 * The one docked pill. `caption` is the server's reason when the chosen action is refused.
 * With nothing chosen and nothing that CAN be chosen (a phone with nothing to repair whose swap
 * still needs the new phone), "Choose one" would send the advisor to tiles that
 * don't answer: the pill names the verdict's action — the swap when there is no verdict — and
 * the server's reason it can't be done yet.
 */
export function pill(o: Offer, pick: Pick | null): { title: string; disabled: boolean; caption: string | null } {
  if (!pick) {
    if (pickAllowed(o, "repair") || pickAllowed(o, "swap")) return { title: "Choose one", disabled: true, caption: null };
    const blocked = o.recommended ?? "swap";
    return { title: PILL_TITLE[blocked], disabled: true, caption: refusal(o, blocked) };
  }
  const why = refusal(o, pick);
  return { title: PILL_TITLE[pick], disabled: why !== null, caption: why };
}

/** The trade-in tile's link to the new-phone sheet (and the new-phone ask's button). */
export const CHOOSE_PHONE = "Choose the new phone";

/** No price from PriceIQ, a rate card or a typed quote — the desk's words (owner, 2026-10-18). Same as ../buySell.ts. */
export const NO_MARKET_PRICE = "No market price yet — enter a quote.";

/** The line under "—" on the Trade-in + bonus tile: the server's why; with none, NO_MARKET_PRICE. null while there is a total. */
export function swapWhyLine(o: Offer): string | null {
  if (o.swap.total !== null) return null;
  return o.swap.why ?? (o.swap.tradeIn === null ? NO_MARKET_PRICE : null);
}

/**
 * The swap's refusal as a line in the Trade-in + bonus tile, or null when the tile already says it:
 * as the why under "—", as the trade-in note (an expired partner quote), or as the
 * "Choose the new phone" link when no phone is chosen.
 */
export function swapRefusalLine(o: Offer): string | null {
  const why = o.actions.swap;
  if (why === null) return null;
  const said = (t: string | null) => !!t && t.trim() === why.trim();
  if (said(swapWhyLine(o))) return null;
  if (said(o.swap.tradeInNote)) return null;
  if (!o.swap.newPhone && why.trim().replace(/\.$/, "") === CHOOSE_PHONE) return null;
  return why;
}

/**
 * Re-price the case once, quietly, when the answer opens: a partner quote that has expired
 * (the server re-quotes a rate-card or live one; one typed from the partner's app comes back as
 * the "Enter the partner's quote" ask), or storage chips none of which has a price — the case was
 * priced before the server kept a trade-in per size, and a re-price makes it work them out.
 * Never on a closed case; a size the partner truly can't price stays a bare chip after the one re-price.
 */
export function wantsReprice(open: boolean, quoteExpired: boolean, o: Offer | null): boolean {
  if (!open) return false;
  if (quoteExpired) return true;
  const ask = o?.asks.find((a) => a.kind === "storage");
  return !!ask && ask.kind === "storage" && ask.options.length > 0 && ask.options.every((x) => x.tradeIn === null);
}

/**
 * Where a storage ask with no chip sends the advisor. The server offers none when the phone measured
 * a size the model's list doesn't have (a 1TB Ultra on file as 256/512GB): its text says to enter the
 * partner's quote on the full case, and the desk's answer card takes it (#answer) — the quote sets the
 * storage to the measured size. Step 1 can't: its chips are the sizes the phone ruled out. With no
 * measurement (a model with no sizes on file), step 1 is where the storage is chosen.
 */
export function storageHandoff(head: { measuredStorage: CaseHead["measuredStorage"] }): { title: string; hash: string } {
  return head.measuredStorage ? { title: "Enter the quote", hash: "#answer" } : { title: "Choose storage", hash: "#step-phone" };
}

/** A storage chip: "256GB · ₹18,800", or just "512GB" when the partner has no price for that size. */
export function chipLabel(opt: StorageOption): string {
  return opt.tradeIn === null ? opt.variant : `${opt.variant} · ${inr(opt.tradeIn)}`;
}

/** "4%" from 400 bp, "2.5%" from 250. */
const percent = (bp: number) => `${Math.round(bp) / 100}%`;

/** Under Trade-in + bonus: "Trade-in ₹18,800 + bonus ₹6,199 (4%)", or "Trade-in ₹18,800 · <why no bonus>". null without a trade-in (the tile shows swapWhyLine). */
export function bonusLine(o: Offer): string | null {
  const s = o.swap;
  if (s.tradeIn === null) return null;
  const trade = `Trade-in ${inr(s.tradeIn)}`;
  if (s.bonus !== null && s.bonus > 0) return `${trade} + bonus ${inr(s.bonus)}${s.bonusBp !== null ? ` (${percent(s.bonusBp)})` : ""}`;
  return s.bonusWhy ? `${trade} · ${s.bonusWhy}` : trade;
}

/** "Galaxy S26 Ultra 256GB ₹1,54,999 · customer pays ₹1,30,000"; null with no new phone chosen. */
export function newPhoneLine(o: Offer): string | null {
  const p = o.swap.newPhone;
  if (!p) return null;
  const head = `${p.label} ${inr(p.price)}`;
  return o.swap.customerPays === null ? head : `${head} · customer pays ${inr(o.swap.customerPays)}`;
}

/** The swap against the repair, in what the customer pays today. null when there is nothing to compare. */
export function vsRepairLine(n: number | null): string | null {
  if (n === null) return null;
  if (n > 0) return `${inr(n)} more than repair`;
  if (n < 0) return `${inr(-n)} less than repair`;
  return "Same as repair";
}

// ── the SwapUp grade (CaseView.grading) ──────────────────────────────────────
//
// One grade from the phone's tests (SwapUp Check, and Phonecheck where the store has a station):
// Superb > Good > Fair > Best Value, with its letter A–D. The SERVER grades and writes the label —
// "Good (B)", "Good (B) · provisional", "Needs repair"… — and the why (lib/domain/grading.ts, the
// one letter rule); the app prints the label as sent and only draws " · provisional" in amber.
// The grade NEVER moves a price: readOffer and every money line above ignore it.
// Shape: grading spec §4.5 CaseView.grading.

export type GradeLetter = "A" | "B" | "C" | "D";
export type GradingStatus = "not_tested" | "cannot_grade" | "needs_repair" | "incomplete" | "graded";

const GRADING_STATUSES = ["not_tested", "cannot_grade", "needs_repair", "incomplete", "graded"] as const;
const LETTERS = ["A", "B", "C", "D"] as const;

/** The report's one plain line about the letter (owner's words). */
export const LETTER_NOTE = "A = Superb, B = Good, C = Fair, D = Best Value — not a CTIA grade.";
/** What the grade is, and what it isn't (spec §2.1). */
export const SCALE_NOTE = "SwapUp grade, as tested at the store — not the buyer's own inspection.";

export type CaseGrading = {
  status: GradingStatus;
  /** The server's label, printed as sent: "Good (B)", "Good (B) · provisional", "Needs repair"… */
  label: string;
  /** The server's grade word ("Good"); only when status is "graded". */
  grade: string | null;
  /** The server's letter; only beside a grade. */
  letter: GradeLetter | null;
  /** Graded with nothing left to check by hand. Never true for any other status. */
  final: boolean;
  /** The one-line why (the first reason), the server's words. */
  why: string | null;
  /** The issued report; `path` is the public "/r/<token>" link, safe to show the customer (no prices in it). */
  report: { path: string; version: number | null; sha256: string | null; issuedAt: string | null; final: boolean } | null;
  /** null for a partner viewer. `canPull` false = the store can't fetch Phonecheck results, and `why`. */
  phonecheck: { canPull: boolean; why: string | null } | null;
};

/**
 * A link the app may open: the server's relative path ("/r/<token>?v=2") or its own absolute
 * http(s) address. Anything else (another scheme, "//host", spaces) is no link at all.
 */
function linkPath(x: unknown): string | null {
  const p = str(x)?.trim() ?? null;
  if (!p || /\s|\\/.test(p)) return null;
  if (/^https?:\/\/[^/?#]+/i.test(p)) return p;
  return p.startsWith("/") && !p.startsWith("//") ? p : null;
}
const SHA256 = /^[0-9a-f]{64}$/i;

/** CaseView.grading, or null (an older server, nothing graded yet, junk). Never throws. */
export function readCaseGrade(x: unknown): CaseGrading | null {
  const o = obj(x);
  const status = oneOf(o?.status, GRADING_STATUSES);
  const label = str(o?.label)?.trim() ?? null;
  if (!o || !status || !label) return null;
  const grade = status === "graded" ? (str(o.grade)?.trim() ?? null) : null;
  const rep = obj(o.report);
  const path = linkPath(rep?.path);
  const version = rep && typeof rep.version === "number" && Number.isInteger(rep.version) && rep.version > 0 ? rep.version : null;
  const pc = obj(o.phonecheck);
  return {
    status,
    label,
    grade,
    letter: grade ? oneOf(o.letter, LETTERS) : null,
    final: status === "graded" && o.final === true,
    why: str(o.why),
    report: rep && path ? { path, version, sha256: typeof rep.sha256 === "string" && SHA256.test(rep.sha256) ? rep.sha256.toLowerCase() : null, issuedAt: str(rep.issuedAt), final: rep.final === true } : null,
    phonecheck: pc ? { canPull: pc.canPull === true, why: str(pc.why) } : null,
  };
}

const PROVISIONAL = /\s*·\s*provisional\s*$/i;

/**
 * The server's label as the screens print it after "SwapUp grade: ". `full` is the label as sent;
 * `text` is the same without its " · provisional" mark, which the screen draws in amber.
 */
export function gradeLine(g: CaseGrading): { text: string; provisional: boolean; full: string } {
  const text = g.label.replace(PROVISIONAL, "").trim();
  if (!text || text === g.label) return { text: g.label, provisional: false, full: g.label };
  return { text, provisional: true, full: g.label };
}

/** "Report v2 · 3f9a0c1d": the version and the first 8 characters of its fingerprint, as on the receipt. null without either. */
export function reportRef(r: CaseGrading["report"]): string | null {
  if (!r) return null;
  const bits = [r.version !== null ? `Report v${r.version}` : null, r.sha256 ? r.sha256.slice(0, 8) : null].filter(Boolean);
  return bits.length ? bits.join(" · ") : null;
}

// ── Phonecheck results (POST /api/cases/<id>/phonecheck {mode: "pull"}) ─────

export type PullOutcome = "attached" | "not_found" | "stale" | "mismatch";
/** What the advisor reads after the pull when the server sends no `note` of its own (an older server, or "attached"). */
export const PULL_TEXT: Record<PullOutcome, string> = {
  attached: "Phonecheck results added.",
  not_found: "No Phonecheck results yet — test it on the station.",
  stale: "Nothing newer on Phonecheck.",
  mismatch: "Phonecheck has a different IMEI — a manager can attach it.",
};

/**
 * The pull's answer {case, record, outcome, note}. `caseView` is the whole CaseView to paint (null =
 * the server sent none: read the case again). `text` is the server's own `note` when it wrote one
 * ("Phonecheck has no test of this IMEI on this account…"), else PULL_TEXT. null when the answer
 * isn't a pull answer at all.
 */
export function readPull(x: unknown): { caseView: unknown; outcome: PullOutcome; text: string } | null {
  const o = obj(x);
  const outcome = oneOf(o?.outcome, ["attached", "not_found", "stale", "mismatch"] as const);
  if (!o || !outcome) return null;
  const c = obj(o.case);
  const note = str(o.note)?.trim();
  return { caseView: c && typeof c.id === "string" && typeof c.status === "string" ? c : null, outcome, text: note || PULL_TEXT[outcome] };
}
