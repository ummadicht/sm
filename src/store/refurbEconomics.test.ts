// node --test --experimental-strip-types --no-warnings src/store/refurbEconomics.test.ts
// The staff REFURB DECISION as the store app reads it (CaseView.refurbEconomics, ~/projects/swapup
// lib/domain/refurbEconomics.ts; docs/MOBILE-API.md §3b). The payloads below are the server's own,
// word for word: SUP-92's worked examples run through the server's refurbEconomics()
// (lib/domain/refurbEconomics.test.ts) — the S23 Ultra 256GB on the week-42 card (A 34,960 ·
// B 33,574 · C 32,255 · D 30,672), SwapUp's % per defect with charger / box / bill / age at 0, the
// seeded price book (tier S labour ₹425, GST 18%), the S26 Ultra 256GB with a 3% bonus (₹4,649).
// The app works nothing out: every figure and every reason is printed as sent.
// Same import trick as ./pin.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const R: typeof import("./refurbEconomics") = await import("./refurbEconomics" + ".ts");

const BONUS_LINE = "As on the answer · + ₹4,649 bonus with the Galaxy S26 Ultra 256GB";
const S26U = "Galaxy S26 Ultra 256GB";
const SCREEN_ESTIMATE = "SwapUp's repair estimate: display assembly ₹28,470 + labour ₹425 + GST ₹5,201";
const BACK_ESTIMATE = "SwapUp's repair estimate: back glass / cover ₹3,470 + labour ₹425 + GST ₹701";
const BACK_MARKET = "Market price — priced at grade A ₹34,960, less 15% back glass cracked";

/**
 * (a) Cracked back, screen flawless: the card priced it at grade A less 15% for the back glass;
 * repaired, the 15% comes back at grade A ₹34,960 — 34,960 − 29,710 − 4,596 = +₹654, repair before
 * pickup (owner, SUP-92). "priced at grade A", never "grade A": the answer's grade line says B.
 */
const A = {
  preRefurb: { amount: 29710, grade: "A", source: BACK_MARKET, why: null },
  repairCost: { amount: 4596, basis: "estimate", source: BACK_ESTIMATE, why: null },
  postRepair: { amount: 34960, grade: "A", source: "Grade A price", why: null },
  uplift: { amount: 654, verdict: "repair", text: "Repair before pickup: +₹654", why: null },
  offer: { amount: 30898, bonus: 4649, newPhone: S26U, source: BONUS_LINE, why: null },
};
/** (b) Cracked screen: the display costs more than it adds. */
const B = {
  preRefurb: { amount: 20970, grade: "A", source: "Market price — priced at grade A ₹34,960, less 40% screen cracked", why: null },
  repairCost: { amount: 34096, basis: "estimate", source: SCREEN_ESTIMATE, why: null },
  postRepair: { amount: 34960, grade: "A", source: "Grade A price", why: null },
  uplift: { amount: -20106, verdict: "as_is", text: "Send as-is — repairing costs ₹20,106 more than it adds", why: null },
  offer: { amount: 21808, bonus: 4649, newPhone: S26U, source: BONUS_LINE, why: null },
};
/** (c) Light wear (scratched screen, scuffed body), no faults: grade B, nothing to repair. */
const C = {
  preRefurb: { amount: 33574, grade: "B", source: "Market price — grade B price", why: null },
  repairCost: { amount: 0, basis: "none", source: "Nothing to repair", why: null },
  postRepair: { amount: 33574, grade: "B", source: "Grade B price", why: null },
  uplift: { amount: null, verdict: "nothing_to_repair", text: "Nothing to repair", why: null },
  offer: { amount: 34581, bonus: 4649, newPhone: S26U, source: BONUS_LINE, why: null },
};
const NOT_ON_CARD = "This phone isn't on the rate card yet.";
const NO_CARD = "No rate card is active yet.";
/** (a) with the store's own repair cost. */
const STORE = {
  ...A,
  repairCost: { amount: 2000, basis: "store", source: "The store's own figure, entered by Ravi", why: null },
  uplift: { amount: 3250, verdict: "repair", text: "Repair before pickup: +₹3,250", why: null },
};
/** Liquid damage: a bench check, so no repair cost and no decision. */
const WET = {
  preRefurb: { amount: 19220, grade: "A", source: "Market price — priced at grade A ₹34,960, less 45% signs of liquid damage", why: null },
  repairCost: { amount: null, basis: null, source: null, why: "Bench check needed (Liquid damage) — enter the store's repair cost." },
  postRepair: { amount: 34960, grade: "A", source: "Grade A price", why: null },
  uplift: { amount: null, verdict: null, text: null, why: "Needs the repair cost." },
  offer: { amount: 19988, bonus: 4649, newPhone: S26U, source: BONUS_LINE, why: null },
};

/** GET /api/cases/<id> as the store app gets it (the fields the reader looks at, and a few it doesn't). */
function caseView(refurbEconomics: unknown, over: Record<string, unknown> = {}) {
  return {
    id: "case_1",
    ref: "SU-AW01-00012",
    status: "quoted",
    device: { modelId: "galaxy-s23-ultra", model: "Galaxy S23 Ultra", variant: "256GB" },
    quote: { status: "priced", amount: 29710, source: { kind: "partner_ratecard", label: "Week 42" } },
    refurbCost: null,
    ...(refurbEconomics === undefined ? {} : { refurbEconomics }),
    ...over,
  };
}

const read = (e: unknown, over: Record<string, unknown> = {}) => {
  const d = R.readRefurbDecision(caseView(e, over));
  assert.ok(d, "should show the panel");
  return d;
};

/** What the screen prints, line by line: label, figure (null = "—"), the line under it. */
function printed(d: NonNullable<ReturnType<typeof R.readRefurbDecision>>) {
  const { preRefurb: pre, repairCost: cost, postRepair: post, uplift, offer } = d.lines;
  return [
    [R.LABEL.preRefurb, pre.amount, R.subLine(pre)],
    [R.LABEL.repairCost, cost.amount, R.subLine(cost)],
    [R.LABEL.postRepair, post.amount, R.subLine(post)],
    [R.LABEL.uplift, R.decisionText(uplift), uplift.why],
    [R.LABEL.offer, offer.amount, R.subLine(offer)],
  ];
}

// ── the worked examples ─────────────────────────────────────────────────────

test("(a) cracked back: ₹29,710 · ₹4,596 · ₹34,960 (grade A) · repair before pickup +₹654 · ₹30,898 + ₹4,649 — as the server sent it", () => {
  const d = read(A);
  assert.deepEqual(d.lines, A, "every field reads back as sent");
  assert.equal(d.editable, true);
  assert.deepEqual(printed(d), [
    ["Pre-refurb value", 29710, BACK_MARKET],
    ["Repair cost", 4596, BACK_ESTIMATE],
    ["Post-repair value", 34960, "Grade A price"],
    ["Repair uplift · post-repair − pre-refurb − repair cost", "Repair before pickup: +₹654", null],
    ["SwapUp offer · we pay you", 30898, BONUS_LINE],
  ]);
  // The server's uplift is its own three figures' difference; the app only prints it.
  assert.equal(d.lines.uplift.amount, 34960 - 29710 - 4596);
  // SwapUp's estimate is on the line, not in the store's box.
  assert.equal(R.costText(d.lines), "");
  assert.equal(R.costPlaceholder(d.lines), "enter if different");
});

test("(b) cracked screen: ₹20,970 · ₹34,096 · ₹34,960 (grade A) · send as-is, −₹20,106", () => {
  const d = read(B);
  assert.deepEqual(d.lines, B);
  assert.deepEqual(printed(d), [
    ["Pre-refurb value", 20970, "Market price — priced at grade A ₹34,960, less 40% screen cracked"],
    ["Repair cost", 34096, SCREEN_ESTIMATE],
    ["Post-repair value", 34960, "Grade A price"],
    ["Repair uplift · post-repair − pre-refurb − repair cost", "Send as-is — repairing costs ₹20,106 more than it adds", null],
    ["SwapUp offer · we pay you", 21808, BONUS_LINE],
  ]);
});

test("(c) light wear, no faults: ₹33,574 (grade B) · nothing to repair (₹0) · ₹33,574 · no uplift beyond 'Nothing to repair'", () => {
  const d = read(C);
  assert.deepEqual(d.lines, C);
  assert.deepEqual(printed(d), [
    ["Pre-refurb value", 33574, "Market price — grade B price"],
    ["Repair cost", 0, "Nothing to repair"],
    ["Post-repair value", 33574, "Grade B price"],
    ["Repair uplift · post-repair − pre-refurb − repair cost", "Nothing to repair", null],
    ["SwapUp offer · we pay you", 34581, BONUS_LINE],
  ]);
  assert.equal(d.lines.uplift.amount, null, "no uplift figure");
  assert.equal(R.costText(d.lines), "", "₹0 is the line's, not the store's");
});

test("(d) not on the card, or no card: no trade-in price, so the server sends no panel (the answer's Swap up side says why, once)", () => {
  for (const why of [NOT_ON_CARD, NO_CARD]) {
    assert.equal(R.readRefurbDecision(caseView(null, { quote: { status: "unpriced", amount: null, reason: why } })), null, why);
  }
});

// ── the other decisions ─────────────────────────────────────────────────────

test("the store's own repair cost: the server's line says so, the box holds it, and the decision is the server's", () => {
  const d = read(STORE, { refurbCost: { amount: 2000, by: "Ravi" } });
  assert.deepEqual(d.lines.repairCost, { amount: 2000, basis: "store", source: "The store's own figure, entered by Ravi", why: null });
  assert.deepEqual(d.lines.uplift, { amount: 3250, verdict: "repair", text: "Repair before pickup: +₹3,250", why: null });
  assert.equal(R.decisionText(d.lines.uplift), "Repair before pickup: +₹3,250");
  assert.equal(R.costText(d.lines), "2000", "the store's own figure is in its box");
});

test("a repair with no price: the repair cost is '—' with the server's why, the box is empty, and the decision says what it needs", () => {
  const d = read(WET);
  assert.deepEqual(printed(d)[1], ["Repair cost", null, "Bench check needed (Liquid damage) — enter the store's repair cost."]);
  assert.deepEqual(printed(d)[3], ["Repair uplift · post-repair − pre-refurb − repair cost", "—", "Needs the repair cost."]);
  assert.equal(R.costText(d.lines), "");
  assert.equal(R.costPlaceholder(d.lines), "—");
});

test("no new phone: the offer is what we pay, as on the answer, no bonus", () => {
  const d = read({ ...A, offer: { amount: 30898, bonus: null, newPhone: null, source: "As on the answer", why: null } });
  assert.deepEqual(printed(d)[4], ["SwapUp offer · we pay you", 30898, "As on the answer"]);
});

test("the line under a figure is where it came from, else why it's missing", () => {
  assert.equal(R.subLine({ amount: 1, source: "Grade B price", why: null }), "Grade B price");
  assert.equal(R.subLine({ amount: null, source: null, why: NO_CARD }), NO_CARD);
  assert.equal(R.subLine({ amount: null, source: null, why: null }), null);
});

// ── when there is no panel ──────────────────────────────────────────────────

test("an older server (no refurbEconomics), the partner (null), or a field that doesn't read whole: no panel — never half the numbers", () => {
  assert.equal(R.readRefurbDecision(caseView(undefined)), null, "older server");
  assert.equal(R.readRefurbDecision(caseView(null)), null, "partner");
  const { uplift: _u, ...noUplift } = A;
  const { offer: _o, ...noOffer } = A;
  for (const bad of [
    "x",
    [],
    {},
    noUplift,
    noOffer,
    { ...A, preRefurb: null },
    { ...A, postRepair: "₹34,960" },
    { ...A, repairCost: { ...A.repairCost, amount: "4596" } },
    { ...A, offer: { ...A.offer, bonus: Number.NaN } },
    { ...A, uplift: { ...A.uplift, text: 654 } },
  ]) {
    assert.equal(R.readRefurbDecision(caseView(bad)), null, JSON.stringify(bad));
  }
  // An enum a newer server adds reads as null; the figures still show.
  const d = read({ ...A, postRepair: { ...A.postRepair, grade: "Premium" }, uplift: { ...A.uplift, verdict: "later" } });
  assert.deepEqual([d.lines.postRepair.grade, d.lines.postRepair.amount, d.lines.uplift.verdict, d.lines.uplift.text], [null, 34960, null, A.uplift.text]);
});

test("shown exactly when the server sends it — at the counter (editable) and traded in until pickup (read-only); the server sends null otherwise", () => {
  assert.equal(read(A, { status: "draft" }).editable, true);
  assert.equal(read(A, { status: "quoted" }).editable, true);
  // "Repair before pickup" is acted on between the lock and the partner's pickup.
  assert.equal(read(A, { status: "locked" }).editable, false);
  assert.equal(read(A, { status: "in_pickup" }).editable, false);
  // Repair chosen, walked away, cancelled, collected: no trade-in to decide on — the server sends null.
  for (const status of ["repair_chosen", "walked_away", "cancelled", "collected"]) assert.equal(R.readRefurbDecision(caseView(null, { status })), null, status);
  for (const bad of [null, undefined, "x", 3, [], {}, { status: 1, quote: {}, refurbEconomics: A }]) assert.equal(R.readRefurbDecision(bad), null, JSON.stringify(bad));
});

// ── the desk's words and order ──────────────────────────────────────────────

test("the title, the five labels and their order are the desk's", () => {
  assert.equal(R.TITLE, "Refurb decision · staff only");
  assert.deepEqual(
    R.ORDER.map((k) => R.LABEL[k]),
    ["Pre-refurb value", "Repair cost", "Post-repair value", "Repair uplift · post-repair − pre-refurb − repair cost", "SwapUp offer · we pay you"]
  );
  assert.deepEqual(Object.keys(read(A).lines), [...R.ORDER]);
});

// ── the store's own repair cost box ─────────────────────────────────────────

test("the box: digits only, whole rupees up to ₹5,00,000; it holds the store's own figure only, and Save takes any usable figure until the line is the store's", () => {
  assert.equal(R.costInput("₹4,596"), "4596");
  assert.equal(R.costInput("3200.50"), "3200.50");
  assert.equal(R.costInput("1234567890"), "123456789");
  assert.deepEqual(R.readCost(""), { amount: null, problem: null });
  assert.deepEqual(R.readCost("3200.50"), { amount: null, problem: "Whole rupees only." });
  assert.deepEqual(R.readCost("500001"), { amount: null, problem: "Up to ₹5,00,000." });
  assert.deepEqual(R.readCost(" 2000 "), { amount: 2000, problem: null });
  assert.deepEqual(R.readCost("0"), { amount: 0, problem: null });

  // SwapUp's estimate on the line: the box is empty, and any usable figure saves — the estimate's own too.
  const d = read(A);
  assert.equal(R.costText(d.lines), "");
  assert.equal(R.canSaveCost(d, "4596"), true, "staff may adopt SwapUp's estimate as the store's own");
  assert.equal(R.canSaveCost(d, "2000"), true);
  assert.equal(R.canSaveCost(d, ""), false);
  assert.equal(R.canSaveCost(d, "3200.50"), false);
  assert.equal(R.canSaveCost(d, "500001"), false);
  // Nothing to repair (₹0 on the line): the box is empty too, and ₹0 can be saved as the store's.
  assert.equal(R.canSaveCost(read(C), "0"), true);
  // The store's own figure: in the box, and Save only once it differs.
  const own = read(STORE);
  assert.equal(R.costText(own.lines), "2000");
  assert.equal(R.costPlaceholder(own.lines), "—");
  assert.equal(R.canSaveCost(own, "2000"), false, "the store's own figure, unchanged");
  assert.equal(R.canSaveCost(own, "2500"), true);
  // Past the counter: read-only.
  assert.equal(R.canSaveCost(read(A, { status: "locked" }), "2000"), false, "past the counter");
  // No figure on the line: any usable number can be saved, ₹0 included.
  assert.equal(R.canSaveCost(read(WET), "0"), true);
  assert.deepEqual(R.costPatch(2000), { refurbCost: { amount: 2000 } });
});
