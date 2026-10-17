// node --test --experimental-strip-types --no-warnings src/store/buySell.test.ts
// The PRICE card (Buy vs Sell, refurb cost, margin) as the store app reads a case
// (CaseView in ~/projects/swapup lib/server/cases.ts). Same import trick as ./pin.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const B: typeof import("./buySell") = await import("./buySell" + ".ts");

const priced = (amount: number, extra: Record<string, unknown> = {}) => ({ status: "priced", amount, lines: [], source: { kind: "partner_ratecard", label: "Rate card" }, ...extra });
const market = { amount: 21119, listing: 21999, markdownBp: 400, grade: "Good", gradeWanted: "Good", listings: 2, week: "2026-W35", why: null, source: "PriceIQ · Cashify refurbished" };
const noMarket = { amount: null, why: "PriceIQ has no Cashify refurbished price for the Galaxy S23 128GB.", source: "PriceIQ · Cashify refurbished" };

/** A case the way GET /api/cases/<id> answers: priced, PriceIQ sell price, SwapUp's repair estimate. */
function caseView(over: Record<string, unknown> = {}) {
  return {
    id: "case_1",
    ref: "SU-AW01-00012",
    status: "quoted",
    device: { modelId: "galaxy-s23", brand: "Samsung", model: "Galaxy S23", variant: "128GB" },
    condition: { screen: "cracked" },
    conditionProblems: [],
    faults: ["screen_cracked"],
    quoteBlocked: null,
    quote: priced(12000),
    quoteExpired: false,
    repairedQuote: priced(18500),
    repair: { status: "quoted", basis: "book", customerPays: 3200, listTotal: 3200, lines: [] },
    manualRepair: null,
    refurbCost: null,
    marketSell: market,
    repairNotServiced: null,
    ...over,
  };
}

const read = (over: Record<string, unknown> = {}) => {
  const c = B.readCasePrice(caseView(over));
  assert.ok(c, "should read as a case");
  return c;
};

test("readCasePrice: a case reads; anything else is null", () => {
  assert.equal(read().id, "case_1");
  for (const bad of [null, undefined, "x", 3, [], {}, { id: "c" }, { status: "quoted" }, { session: { id: "s", status: "applied" } }]) {
    assert.equal(B.readCasePrice(bad), null, JSON.stringify(bad));
  }
});

test("buy vs sell: the partner's as-is price against PriceIQ's marked-down Cashify listing", () => {
  const m = B.priceCard(read(), "3200");
  assert.deepEqual(m.buy, { amount: 12000, note: null });
  assert.equal(m.sell.amount, 21119);
  assert.equal(m.sell.source, "Cashify Good ₹21,999 − 4%");
  assert.deepEqual(m.refurb, { amount: 3200, problem: null });
  assert.deepEqual(m.margin, { amount: 21119 - 12000 - 3200, note: null });
});

test("sell names a lower grade when Cashify listed none at the phone's own", () => {
  const m = B.priceCard(read({ marketSell: { ...market, grade: "Fair", gradeWanted: "Good" } }), "3200");
  assert.equal(m.sell.source, "Cashify Fair ₹21,999 − 4% · none at Good");
});

test("no PriceIQ listing: sell falls back to the partner's repaired price, and says so", () => {
  const m = B.priceCard(read({ marketSell: noMarket }), "3200");
  assert.equal(m.sell.amount, 18500);
  assert.equal(m.sell.source, "Partner's repaired price");
  assert.equal(m.margin.amount, 18500 - 12000 - 3200);
});

test("no PriceIQ listing and no repaired price: PriceIQ's reason, no margin", () => {
  const m = B.priceCard(read({ marketSell: noMarket, repairedQuote: null }), "3200");
  assert.equal(m.sell.amount, null);
  assert.equal(m.sell.note, noMarket.why);
  assert.equal(m.margin.note, "Needs the sell price.");
});

test("margin goes negative when the refurb costs more than it adds", () => {
  const m = B.priceCard(read(), "12000");
  assert.equal(m.margin.amount, 21119 - 12000 - 12000);
  assert.ok((m.margin.amount ?? 0) < 0);
});

test("refurb box starts from the estimate at LIST price — a covered phone still costs the store its parts", () => {
  const c = read({ repair: { status: "quoted", customerPays: 0, listTotal: 6400 } });
  assert.deepEqual(B.refurbStart(c), { amount: 6400, saved: false, note: "SwapUp's repair estimate." });
  assert.equal(B.refurbText(c), "6400");
  assert.equal(B.priceCard(c, "6400").canSave, false, "the untouched estimate is already what the margin uses");
  assert.equal(B.priceCard(c, "7000").canSave, true);
});

test("a saved refurb cost wins over the estimate; Save only when the box differs from it", () => {
  const c = read({ refurbCost: { amount: 4500, by: "Priya", at: "2026-10-17T10:00:00Z" } });
  assert.deepEqual(B.refurbStart(c), { amount: 4500, saved: true, note: "Saved by Priya." });
  assert.equal(B.priceCard(c, "4500").canSave, false);
  assert.equal(B.priceCard(c, "4600").canSave, true);
  assert.equal(B.priceCard(c, "0").canSave, true, "₹0 is a real figure");
});

test("the customer's repair quote (manualRepair) is NOT the store's refurb cost", () => {
  const c = read({ manualRepair: { amount: 9999, reason: "Job sheet 1234", by: "Priya" } });
  assert.equal(B.refurbStart(c).amount, 3200);
  assert.equal(B.refurbStart(c).saved, false);
});

test("refurb start with no estimate: ₹0 when there are no faults (the server sends repair: null), else empty with why", () => {
  assert.deepEqual(B.refurbStart(read({ repair: null, faults: [] })), { amount: 0, saved: false, note: "Nothing to repair." });
  assert.equal(B.refurbText(read({ repair: null, faults: [] })), "0");
  assert.equal(B.refurbStart(read({ repair: { status: "nothing_to_repair", customerPays: null, listTotal: null } })).amount, 0);
  const bench = B.refurbStart(read({ repair: { status: "needs_inspection", customerPays: null, listTotal: null } }));
  assert.equal(bench.amount, null);
  assert.match(bench.note ?? "", /bench/);
  const unpriced = B.refurbStart(read({ repair: { status: "unpriced", customerPays: null, listTotal: null } }));
  assert.equal(unpriced.amount, null);
  const other = B.refurbStart(read({ repair: null, repairNotServiced: "This centre repairs Samsung phones only." }));
  assert.equal(other.note, "This centre repairs Samsung phones only.");
});

test("refurb input: digits only, whole rupees, the server's ceiling", () => {
  assert.equal(B.refurbInput("₹3,200"), "3200");
  assert.equal(B.refurbInput("12.50"), "12.50");
  assert.deepEqual(B.readRefurb("3200"), { amount: 3200, problem: null });
  assert.deepEqual(B.readRefurb("0"), { amount: 0, problem: null });
  assert.equal(B.readRefurb("").problem, "Enter the refurb cost.");
  assert.equal(B.readRefurb("12.50").problem, "Whole rupees only.");
  assert.equal(B.readRefurb("500001").problem, "Up to ₹5,00,000.");
  assert.deepEqual(B.readRefurb("500000"), { amount: 500000, problem: null });
});

test("the PATCH body saves the figure as the case's refurbCost — never as the customer's repair quote", () => {
  assert.deepEqual(B.refurbPatch(4200), { refurbCost: { amount: 4200 } });
});

test("no quote yet: Buy is — with the server's reason; margin names what is missing", () => {
  const m = B.priceCard(read({ quote: null, repairedQuote: null, marketSell: { amount: null, why: null }, device: { variant: null } }), "3200");
  assert.equal(m.buy.amount, null);
  assert.match(m.buy.note ?? "", /storage size/);
  assert.equal(m.sell.amount, null);
  assert.equal(m.margin.note, "Needs the buy price and the sell price.");
});

test("partner without a price: the partner's reason", () => {
  const m = B.priceCard(read({ quote: { status: "unpriced", amount: null, reason: "Cashify doesn't buy this model." } }), "3200");
  assert.deepEqual(m.buy, { amount: null, note: "Cashify doesn't buy this model." });
});

test("an expired or sample quote keeps its number with a note", () => {
  assert.deepEqual(B.buyFigure(read({ quoteExpired: true })), { amount: 12000, note: "Quote expired — re-quote on the case." });
  assert.equal(B.buyFigure(read({ quote: priced(12000, { source: { kind: "sample" } }) })).note, "Sample price, not a real quote.");
});

test("past the counter: read-only, no Save", () => {
  const c = read({ status: "locked" });
  assert.ok(B.refurbLocked(c));
  assert.equal(B.priceCard(c, "9999").canSave, false);
});

test("refurbHint: the line under the box", () => {
  const c = read();
  assert.deepEqual(B.refurbHint(c, "3200"), { text: "SwapUp's repair estimate.", bad: false });
  assert.deepEqual(B.refurbHint(c, "4000"), { text: "Not saved yet.", bad: false });
  assert.deepEqual(B.refurbHint(c, "40.5"), { text: "Whole rupees only.", bad: true });
  assert.deepEqual(B.refurbHint(c, ""), { text: "Enter the refurb cost.", bad: false });
  assert.deepEqual(B.refurbHint(read({ repair: { status: "needs_inspection", customerPays: null, listTotal: null } }), ""), {
    text: "Needs a look on the bench — enter your refurb cost.",
    bad: false,
  });
});

test("marginFigure: plain arithmetic, nulls named in order", () => {
  assert.deepEqual(B.marginFigure(10, 2, 15), { amount: 3, note: null });
  assert.deepEqual(B.marginFigure(null, null, null), { amount: null, note: "Needs the buy price, the refurb cost and the sell price." });
  assert.deepEqual(B.marginFigure(1, null, 2), { amount: null, note: "Needs the refurb cost." });
});
