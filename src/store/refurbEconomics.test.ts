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

const BONUS_LINE = "+ ₹4,649 bonus with the Galaxy S26 Ultra 256GB";
const S26U = "Galaxy S26 Ultra 256GB";
const SCREEN_ESTIMATE = "SwapUp's repair estimate: display assembly ₹28,470 + labour ₹425 + GST ₹5,201";
const BACK_ESTIMATE = "SwapUp's repair estimate: back glass / cover ₹3,470 + labour ₹425 + GST ₹701";

/**
 * (a) Cracked back, screen flawless. SUP-92's spec expected grade A ₹34,960 once repaired, an uplift
 * of +₹654 and "Repair before pickup". The server prices it at grade B ₹33,574: healedCondition —
 * the one healing rule the post-repair value, the answer's grade line and the report all read —
 * heals a cracked back only as far as "scuffed" (a new back panel on a frame nobody has seen bare).
 * So the uplift is 33,574 − 29,710 − 4,596 = −₹732: send as-is. The app prints the server's lines.
 */
const A = {
  preRefurb: { amount: 29710, grade: "A", source: "grade A ₹34,960 − 15% back glass cracked", why: null },
  repairCost: { amount: 4596, basis: "estimate", source: BACK_ESTIMATE, why: null },
  postRepair: { amount: 33574, grade: "B", source: "grade B price", why: null },
  uplift: { amount: -732, verdict: "as_is", text: "Send as-is — repairing costs ₹732 more than it adds", why: null },
  offer: { amount: 30898, bonus: 4649, newPhone: S26U, source: BONUS_LINE, why: null },
};
/** (b) Cracked screen: the display costs more than it adds. */
const B = {
  preRefurb: { amount: 20970, grade: "A", source: "grade A ₹34,960 − 40% screen cracked", why: null },
  repairCost: { amount: 34096, basis: "estimate", source: SCREEN_ESTIMATE, why: null },
  postRepair: { amount: 34960, grade: "A", source: "grade A price", why: null },
  uplift: { amount: -20106, verdict: "as_is", text: "Send as-is — repairing costs ₹20,106 more than it adds", why: null },
  offer: { amount: 21808, bonus: 4649, newPhone: S26U, source: BONUS_LINE, why: null },
};
/** (c) Light wear (scratched screen, scuffed body), no faults: grade B, nothing to repair. */
const C = {
  preRefurb: { amount: 33574, grade: "B", source: "grade B price", why: null },
  repairCost: { amount: 0, basis: "none", source: "Nothing to repair", why: null },
  postRepair: { amount: 33574, grade: "B", source: "grade B price", why: null },
  uplift: { amount: null, verdict: "nothing_to_repair", text: "Nothing to repair", why: null },
  offer: { amount: 34581, bonus: 4649, newPhone: S26U, source: BONUS_LINE, why: null },
};
/** (d) A cracked screen with no price list price: the phone isn't on the card, or no card is active. */
const D = (why: string) => ({
  preRefurb: { amount: null, grade: null, source: null, why },
  repairCost: { amount: 34096, basis: "estimate", source: SCREEN_ESTIMATE, why: null },
  postRepair: { amount: null, grade: null, source: null, why },
  uplift: { amount: null, verdict: null, text: null, why: "Needs the pre-refurb value and the post-repair value." },
  offer: { amount: null, bonus: null, newPhone: S26U, source: null, why },
});
const NOT_ON_CARD = "This phone isn't on the rate card yet.";
const NO_CARD = "No rate card is active yet.";
/** (a) with the store's own repair cost: repairing now adds money. */
const STORE = {
  ...A,
  repairCost: { amount: 2000, basis: "store", source: "The store's own figure, entered by Ravi", why: null },
  uplift: { amount: 1864, verdict: "repair", text: "Repair before pickup: +₹1,864", why: null },
};
/** Liquid damage: a bench check, so no repair cost and no decision. */
const WET = {
  preRefurb: { amount: 19220, grade: "A", source: "grade A ₹34,960 − 45% signs of liquid damage", why: null },
  repairCost: { amount: null, basis: null, source: null, why: "Bench check needed (Liquid damage) — enter the store's repair cost." },
  postRepair: { amount: 34960, grade: "A", source: "grade A price", why: null },
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

test("(a) cracked back: ₹29,710 · ₹4,596 · ₹33,574 (grade B) · send as-is · ₹30,898 + ₹4,649 — as the server sent it", () => {
  const d = read(A);
  assert.deepEqual(d.lines, A, "every field reads back as sent");
  assert.equal(d.editable, true);
  assert.deepEqual(printed(d), [
    ["Pre-refurb value", 29710, "grade A ₹34,960 − 15% back glass cracked"],
    ["Repair cost", 4596, BACK_ESTIMATE],
    ["Post-repair value", 33574, "grade B price"],
    ["Repair uplift · post-repair − pre-refurb − repair cost", "Send as-is — repairing costs ₹732 more than it adds", null],
    ["SwapUp offer", 30898, BONUS_LINE],
  ]);
  // The server's uplift is its own three figures' difference; the app only prints it.
  assert.equal(d.lines.uplift.amount, 33574 - 29710 - 4596);
  assert.equal(R.costText(d.lines), "4596");
});

test("(b) cracked screen: ₹20,970 · ₹34,096 · ₹34,960 (grade A) · send as-is, −₹20,106", () => {
  const d = read(B);
  assert.deepEqual(d.lines, B);
  assert.deepEqual(printed(d), [
    ["Pre-refurb value", 20970, "grade A ₹34,960 − 40% screen cracked"],
    ["Repair cost", 34096, SCREEN_ESTIMATE],
    ["Post-repair value", 34960, "grade A price"],
    ["Repair uplift · post-repair − pre-refurb − repair cost", "Send as-is — repairing costs ₹20,106 more than it adds", null],
    ["SwapUp offer", 21808, BONUS_LINE],
  ]);
});

test("(c) light wear, no faults: ₹33,574 (grade B) · nothing to repair (₹0) · ₹33,574 · no uplift beyond 'Nothing to repair'", () => {
  const d = read(C);
  assert.deepEqual(d.lines, C);
  assert.deepEqual(printed(d), [
    ["Pre-refurb value", 33574, "grade B price"],
    ["Repair cost", 0, "Nothing to repair"],
    ["Post-repair value", 33574, "grade B price"],
    ["Repair uplift · post-repair − pre-refurb − repair cost", "Nothing to repair", null],
    ["SwapUp offer", 34581, BONUS_LINE],
  ]);
  assert.equal(d.lines.uplift.amount, null, "no uplift figure");
  assert.equal(R.costText(d.lines), "0");
});

test("(d) not on the card, or no card: pre-refurb and post-repair missing with the specific reason; no uplift; no offer", () => {
  for (const why of [NOT_ON_CARD, NO_CARD]) {
    const d = read(D(why), { quote: { status: "unpriced", amount: null, reason: why } });
    assert.deepEqual(d.lines, D(why));
    assert.deepEqual(printed(d), [
      ["Pre-refurb value", null, why],
      ["Repair cost", 34096, SCREEN_ESTIMATE],
      ["Post-repair value", null, why],
      ["Repair uplift · post-repair − pre-refurb − repair cost", "—", "Needs the pre-refurb value and the post-repair value."],
      ["SwapUp offer", null, why],
    ]);
  }
});

// ── the other decisions ─────────────────────────────────────────────────────

test("the store's own repair cost: the server's line says so, and 'Repair before pickup' when repairing adds money", () => {
  const d = read(STORE, { refurbCost: { amount: 2000, by: "Ravi" } });
  assert.deepEqual(d.lines.repairCost, { amount: 2000, basis: "store", source: "The store's own figure, entered by Ravi", why: null });
  assert.deepEqual(d.lines.uplift, { amount: 1864, verdict: "repair", text: "Repair before pickup: +₹1,864", why: null });
  assert.equal(R.decisionText(d.lines.uplift), "Repair before pickup: +₹1,864");
});

test("a repair with no price: the repair cost is '—' with the server's why, the box is empty, and the decision says what it needs", () => {
  const d = read(WET);
  assert.deepEqual(printed(d)[1], ["Repair cost", null, "Bench check needed (Liquid damage) — enter the store's repair cost."]);
  assert.deepEqual(printed(d)[3], ["Repair uplift · post-repair − pre-refurb − repair cost", "—", "Needs the repair cost."]);
  assert.equal(R.costText(d.lines), "");
});

test("no new phone: the offer is what we pay, nothing under it", () => {
  const d = read({ ...A, offer: { amount: 30898, bonus: null, newPhone: null, source: null, why: null } });
  assert.deepEqual(printed(d)[4], ["SwapUp offer", 30898, null]);
});

test("the line under a figure is where it came from, else why it's missing", () => {
  assert.equal(R.subLine({ amount: 1, source: "grade B price", why: null }), "grade B price");
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
    { ...A, postRepair: "₹33,574" },
    { ...A, repairCost: { ...A.repairCost, amount: "4596" } },
    { ...A, offer: { ...A.offer, bonus: Number.NaN } },
    { ...A, uplift: { ...A.uplift, text: 654 } },
  ]) {
    assert.equal(R.readRefurbDecision(caseView(bad)), null, JSON.stringify(bad));
  }
  // An enum a newer server adds reads as null; the figures still show.
  const d = read({ ...A, postRepair: { ...A.postRepair, grade: "Premium" }, uplift: { ...A.uplift, verdict: "later" } });
  assert.deepEqual([d.lines.postRepair.grade, d.lines.postRepair.amount, d.lines.uplift.verdict, d.lines.uplift.text], [null, 33574, null, A.uplift.text]);
});

test("shown where the desk shows it: a case with a quote, at the counter (editable) or ended there (read-only); not once traded in", () => {
  assert.equal(read(A, { status: "draft" }).editable, true);
  assert.equal(read(A, { status: "quoted" }).editable, true);
  assert.equal(read(A, { status: "repair_chosen" }).editable, false);
  assert.equal(read(A, { status: "walked_away" }).editable, false);
  for (const status of ["locked", "collected", "cancelled"]) assert.equal(R.readRefurbDecision(caseView(A, { status })), null, status);
  assert.equal(R.readRefurbDecision(caseView(A, { quote: null })), null, "no quote on the case");
  for (const bad of [null, undefined, "x", 3, [], {}, { status: 1, quote: {}, refurbEconomics: A }]) assert.equal(R.readRefurbDecision(bad), null, JSON.stringify(bad));
});

// ── the desk's words and order ──────────────────────────────────────────────

test("the title, the five labels and their order are the desk's", () => {
  assert.equal(R.TITLE, "Refurb decision · staff only");
  assert.deepEqual(
    R.ORDER.map((k) => R.LABEL[k]),
    ["Pre-refurb value", "Repair cost", "Post-repair value", "Repair uplift · post-repair − pre-refurb − repair cost", "SwapUp offer"]
  );
  assert.deepEqual(Object.keys(read(A).lines), [...R.ORDER]);
});

// ── the store's own repair cost box ─────────────────────────────────────────

test("the box: digits only, whole rupees up to ₹5,00,000; Save only for a figure that differs from the line's, at the counter", () => {
  assert.equal(R.costInput("₹4,596"), "4596");
  assert.equal(R.costInput("3200.50"), "3200.50");
  assert.equal(R.costInput("1234567890"), "123456789");
  assert.deepEqual(R.readCost(""), { amount: null, problem: null });
  assert.deepEqual(R.readCost("3200.50"), { amount: null, problem: "Whole rupees only." });
  assert.deepEqual(R.readCost("500001"), { amount: null, problem: "Up to ₹5,00,000." });
  assert.deepEqual(R.readCost(" 2000 "), { amount: 2000, problem: null });
  assert.deepEqual(R.readCost("0"), { amount: 0, problem: null });

  const d = read(A);
  assert.equal(R.canSaveCost(d, "4596"), false, "the line's own figure");
  assert.equal(R.canSaveCost(d, "2000"), true);
  assert.equal(R.canSaveCost(d, ""), false);
  assert.equal(R.canSaveCost(d, "3200.50"), false);
  assert.equal(R.canSaveCost(d, "500001"), false);
  assert.equal(R.canSaveCost(read(A, { status: "repair_chosen" }), "2000"), false, "past the counter");
  // No figure on the line: any usable number can be saved, ₹0 included.
  assert.equal(R.canSaveCost(read(WET), "0"), true);
  assert.deepEqual(R.costPatch(2000), { refurbCost: { amount: 2000 } });
});
