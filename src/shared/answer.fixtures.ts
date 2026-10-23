// The answer's JSON, as the SwapUp server sends it — the contract fixtures F1–F10 of the answer spec
// (session scratchpad swapup-answer-spec.md §A8, with the binding addendum applied: R3 the bonus
// wording, R5 the grade letter without its word beside a defect, R6 the final-state wording, R10
// `text` for the waiting sentence and `repair` for the customer's repair). The server's own tests
// (~/projects/swapup lib/domain/answer.test.ts) hold the same JSON: neither side edits it alone.
// Test data only — nothing the apps bundle imports this file.

const S26 = "Galaxy S26 Ultra 256GB";

/** F1 — customer, ready, open (GET /api/device/status → answer). S23 Ultra 256GB, cracked screen on a dented body, partner quote ₹25,000, suggested S26 Ultra 256GB ₹1,54,999 at a 4% bonus. */
export const F1 = {
  ready: true,
  final: false,
  headline: "An upgrade is worth considering",
  grade: { letter: "C", word: "Fair", note: "screen cracked" },
  market: { amount: 25000, letter: "C", word: "Fair" },
  wePay: 26000,
  bonus: { amount: 6199 },
  newPhone: { label: S26 },
  repair: { amount: 34096, covered: false, nothingToRepair: false },
  lines: [
    { key: "grade", text: "Current grade C", note: "screen cracked", amount: null },
    { key: "market", text: "Market price for grade C ₹25,000", note: null, amount: 25000 },
    { key: "we_pay", text: "We pay you ₹26,000", note: null, amount: 26000 },
    { key: "bonus", text: "+ ₹6,199 bonus if you exchange with a new device", note: S26, amount: 6199 },
    { key: "repair", text: "or repair it for ₹34,096", note: null, amount: 34096 },
  ],
  test: false,
};

/** F2 — customer, not ready (no price yet, or an expired quote). */
export const F2 = { ready: false, final: false, text: "The advisor is working out your price.", test: false };

/**
 * SUP-32 — customer, not ready, and nothing can price the phone (it isn't on the rate card, or no card
 * is active): one honest sentence instead of "working out your price" for the whole visit. The case
 * is still open (final: false); the Check app prints the server's text as it prints F2's.
 */
export const F2_NO_PRICE = { ready: false, final: false, text: "This phone can't be priced for trade-in here yet — the advisor will explain.", test: false };

/** R1 — customer, not ready: the trade-in is SwapUp's PriceIQ estimate, not the rate card's price. */
export const F2_ESTIMATE = { ready: false, final: false, text: "The advisor is confirming your price.", test: false };

/** F3 = F10 — customer, traded in (final): R6's wording, no repair line. */
export const F3 = {
  ...F1,
  final: true,
  headline: "Traded in",
  lines: [
    { key: "grade", text: "Current grade C", note: "screen cracked", amount: null },
    { key: "market", text: "Market price for grade C ₹25,000", note: null, amount: 25000 },
    { key: "we_pay", text: "We paid you ₹26,000", note: null, amount: 26000 },
    { key: "bonus", text: `+ ₹6,199 bonus with the ${S26}`, note: null, amount: 6199 },
  ],
};
export const F10 = F3;

/** F4 — customer, a covered repair and nothing else wrong (a clean body, a cracked screen under warranty). */
export const F4 = {
  ready: true,
  final: false,
  headline: "Repair it — it's covered",
  grade: { letter: "A", word: "Superb", note: "screen cracked" },
  market: { amount: 25000, letter: "A", word: "Superb" },
  wePay: 26000,
  bonus: { amount: 6199 },
  newPhone: { label: S26 },
  repair: { amount: 0, covered: true, nothingToRepair: false },
  lines: [
    { key: "grade", text: "Current grade A", note: "screen cracked", amount: null },
    { key: "market", text: "Market price for grade A ₹25,000", note: null, amount: 25000 },
    { key: "we_pay", text: "We pay you ₹26,000", note: null, amount: 26000 },
    { key: "bonus", text: "+ ₹6,199 bonus if you exchange with a new device", note: S26, amount: 6199 },
    { key: "repair", text: "or repair it free — covered by warranty", note: null, amount: 0 },
  ],
  test: false,
};

/** F5 — customer, nothing to repair and no bonus campaign: grade, market and we-pay lines only. */
export const F5 = {
  ready: true,
  final: false,
  headline: "Nothing to repair — a straight trade-in",
  grade: { letter: "A", word: "Superb", note: null },
  market: { amount: 30000, letter: "A", word: "Superb" },
  wePay: 31200,
  bonus: null,
  newPhone: { label: S26 },
  repair: { amount: null, covered: false, nothingToRepair: true },
  lines: [
    { key: "grade", text: "Current grade A (Superb)", note: null, amount: null },
    { key: "market", text: "Market price for grade A ₹30,000", note: null, amount: 30000 },
    { key: "we_pay", text: "We pay you ₹31,200", note: null, amount: 31200 },
  ],
  test: false,
};

/** F6 — staff `offer.answer` (GET /api/cases/<id>) for the F1 case: F1 plus the staff-only fields. */
export const F6 = {
  ...F1,
  text: null,
  market: { ...F1.market, source: "partner_manual" },
  premium: { amount: 1000, bp: 400, rule: "2026-10-18.1" },
  bonus: { amount: 6199, bp: 400 },
  newPhone: { label: S26, price: 154999 },
  repair: { ...F1.repair, coverage: "none" },
  staffNotes: { market: null, we_pay: "Includes ₹1,000 SwapUp premium (4%).", bonus: "Upgrade bonus · 4%" },
};
/** F6's `offer.swap` in the same response. */
export const F6_SWAP = { tradeIn: 25000, premium: { amount: 1000, bp: 400 }, wePay: 26000, total: 32199, customerPays: 122800 };

/** F8 — staff, not ready: a PriceIQ-priced trade-in (R1). The advisor sees the lines and why the customer doesn't yet. */
export const F8 = {
  ...F6,
  ready: false,
  text: F2_ESTIMATE.text,
  market: { ...F1.market, source: "priceiq" },
  staffNotes: { ...F6.staffNotes, market: "Estimate from the refurbished market — not shown to the customer." },
};

/** F9 — customer, the customer chose the repair (final): R6's wording, grade + repair only. */
export const F9 = {
  ready: true,
  final: true,
  headline: "Repair chosen",
  grade: F1.grade,
  market: null,
  wePay: null,
  bonus: null,
  newPhone: null,
  repair: F1.repair,
  lines: [
    { key: "grade", text: "Current grade C", note: "screen cracked", amount: null },
    { key: "repair", text: "Repair ₹34,096", note: null, amount: 34096 },
  ],
  test: false,
};

/** The customer walked away: the lines as last computed, final. */
export const WALKED_AWAY = { ...F1, final: true };

/** A cancelled trade-in: no figures, final. */
export const CANCELLED = { ready: false, final: true, text: "This trade-in was cancelled.", test: false };

/** Which line keys the customer's answer carries, per case status (R10's table). */
export const LINE_KEYS_BY_STATUS: { status: string; answer: unknown; keys: string[] }[] = [
  { status: "quoted (ready)", answer: F1, keys: ["grade", "market", "we_pay", "bonus", "repair"] },
  { status: "quoted (not ready)", answer: F2, keys: [] },
  { status: "quoted (can't be priced)", answer: F2_NO_PRICE, keys: [] },
  { status: "repair_chosen", answer: F9, keys: ["grade", "repair"] },
  { status: "locked (traded)", answer: F3, keys: ["grade", "market", "we_pay", "bonus"] },
  { status: "walked_away", answer: WALKED_AWAY, keys: ["grade", "market", "we_pay", "bonus", "repair"] },
  { status: "cancelled", answer: CANCELLED, keys: [] },
];

/** F7 — an older server: the status has no `answer` key (and `offer` has none). */
export const F7_STATUS = {
  status: "applied",
  caseRef: "SU-AND-00023",
  reportPath: "/r/AbC123_-xyz",
  grading: { status: "graded", label: "Fair (C)", grade: "Fair", letter: "C", final: true },
};
