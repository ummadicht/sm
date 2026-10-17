// THE ANSWER the advisor shows the customer once the test is applied (owner, 2026-10-17:
// "Why asking questions when we have all tested data ... just refurb quote vs bonus + trade in price"):
//
//   Refurb quote      = offer.repair.amount   what the CUSTOMER pays to fix this phone (the price book,
//                                              a bench/service-centre quote, or ₹0 when covered). Not the
//                                              store's refurb cost — that stays in the "Store margin" card.
//   Trade-in + bonus  = offer.swap.total      the partner's as-is price + the upgrade bonus
//   Verdict           = offer.headline        decide()'s headline, unchanged; the bonus is never a signal
//
// The server builds every number and every reason (lib/domain/offer.ts buildOffer, carried on
// CaseView.offer — spec §3). The app never invents a reason: it reads the server's strings and
// owns only the labels below. A missing number stays null with the server's why.
// Shapes: ~/projects/swapup lib/domain/offer.ts and lib/server/cases.ts CaseView; MOBILE-API.md §3c.
// No React Native imports: the test runs under plain node (./offer.test.ts).

/** Where the case's storage size came from. "customer" = typed on their phone, never measured. */
export type VariantSource = "measured" | "catalogue" | "customer" | "advisor";
/** decide()'s recommendation (lib/domain/decision.ts). */
export type Recommendation = "repair" | "upgrade" | "either" | "no_repair" | "cannot_say";
/** One storage chip. `sample` = its price comes from the SAMPLE rate card (false for a size with no quote). */
export type StorageOption = { variant: string; tradeIn: number | null; sample: boolean };

/** What the answer still needs from the advisor, in the server's order. */
export type OfferAsk =
  | { kind: "blocked"; title: string; text: string }
  | { kind: "model"; title: string; text: string }
  /** `note`: the server's "Sample price — not a real quote." while any priced chip is a sample, else null. */
  | { kind: "storage"; title: string; text: string; options: StorageOption[]; note: string | null }
  | { kind: "partner_quote"; title: string; text: string }
  | { kind: "repair_quote"; title: string; text: string }
  | { kind: "new_phone"; title: string; text: string };

export type Coverage = "none" | "warranty" | "care_plus";
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
    newPhone: { deviceId: string; label: string; price: number; suggested: boolean; why: string | null } | null;
    /** What the customer pays for the new phone (decision.upgrade.pays). */
    customerPays: number | null;
    /** decision.upgrade.extraVsRepair: + = the swap costs the customer more today than the repair. */
    vsRepair: number | null;
  };
  /** null = allowed; a string = why not (the server's own words). */
  actions: { repair: string | null; swap: string | null; walkAway: string | null };
  signals: { text: string; points: "repair" | "upgrade"; strength: "strong" | "soft" }[];
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
export const ACTION_UNKNOWN = "Open the full case to do this.";

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
      // Only an explicit true marks a sample: an older server sends no flag and no note.
      return variant ? { variant, tradeIn: money(q?.tradeIn), sample: q?.sample === true } : null;
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
      newPhone: readNewPhone(sw?.newPhone),
      customerPays: money(sw?.customerPays),
      vsRepair: money(sw?.vsRepair),
    },
    actions: { repair: readAction(act?.repair), swap: readAction(act?.swap), walkAway: readAction(act?.walkAway) },
    signals,
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

const PILL_TITLE: Record<Pick, string> = { repair: "Customer will repair", swap: "Swap up — take the trade-in" };
const refusal = (o: Offer, pick: Pick) => (pick === "repair" ? o.actions.repair : o.actions.swap);

/**
 * The one docked pill. `caption` is the server's reason when the chosen action is refused.
 * With nothing chosen and nothing that CAN be chosen (a phone with nothing to repair whose swap
 * still needs the new phone), "Tap what the customer chose" would send the advisor to tiles that
 * don't answer: the pill names the verdict's action — the swap when there is no verdict — and
 * the server's reason it can't be done yet.
 */
export function pill(o: Offer, pick: Pick | null): { title: string; disabled: boolean; caption: string | null } {
  if (!pick) {
    if (pickAllowed(o, "repair") || pickAllowed(o, "swap")) return { title: "Tap what the customer chose", disabled: true, caption: null };
    const blocked = o.recommended ?? "swap";
    return { title: PILL_TITLE[blocked], disabled: true, caption: refusal(o, blocked) };
  }
  const why = refusal(o, pick);
  return { title: PILL_TITLE[pick], disabled: why !== null, caption: why };
}

/** The trade-in tile's link to the new-phone sheet (and the new-phone ask's button). */
export const CHOOSE_PHONE = "Choose the new phone";

/**
 * The swap's refusal as a line in the Trade-in + bonus tile, or null when the tile already says it:
 * as the why under "—", as the trade-in note (an expired Cashify quote), or as the
 * "Choose the new phone" link when no phone is chosen.
 */
export function swapRefusalLine(o: Offer): string | null {
  const why = o.actions.swap;
  if (why === null) return null;
  const said = (t: string | null) => !!t && t.trim() === why.trim();
  if (o.swap.total === null && said(o.swap.why)) return null;
  if (said(o.swap.tradeInNote)) return null;
  if (!o.swap.newPhone && why.trim().replace(/\.$/, "") === CHOOSE_PHONE) return null;
  return why;
}

/**
 * Re-price the case once, quietly, when the answer opens: a partner quote that has expired
 * (the server re-quotes a rate-card or live one; one typed from the Cashify app comes back as
 * the "Enter the Cashify quote" ask), or storage chips none of which has a price — the case was
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
 * Cashify quote on the full case, and the desk's answer card takes it (#answer) — the quote sets the
 * storage to the measured size. Step 1 can't: its chips are the sizes the phone ruled out. With no
 * measurement (a model with no sizes on file), step 1 is where the storage is chosen.
 */
export function storageHandoff(head: { measuredStorage: CaseHead["measuredStorage"] }): { title: string; hash: string } {
  return head.measuredStorage ? { title: "Enter the Cashify quote on the full case", hash: "#answer" } : { title: "Choose it on the full case", hash: "#step-phone" };
}

/** A storage chip: "256GB · ₹18,800", or just "512GB" when the partner has no price for that size. */
export function chipLabel(opt: StorageOption): string {
  return opt.tradeIn === null ? opt.variant : `${opt.variant} · ${inr(opt.tradeIn)}`;
}

/** "4%" from 400 bp, "2.5%" from 250. */
const percent = (bp: number) => `${Math.round(bp) / 100}%`;

/** Under Trade-in + bonus: "Trade-in ₹18,800 + bonus ₹6,199 (4%)", or "Trade-in ₹18,800 · <why no bonus>". null without a trade-in (the tile shows swap.why). */
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
  if (n > 0) return `${inr(n)} more than repairing today`;
  if (n < 0) return `${inr(-n)} less than repairing`;
  return "Same as repairing";
}
