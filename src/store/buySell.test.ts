// node --test --experimental-strip-types --no-warnings src/store/buySell.test.ts
// The PRICE card (Buy vs Sell, refurb cost, margin) as the store app reads a case
// (CaseView in ~/projects/swapup lib/server/cases.ts). Same import trick as ./pin.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const B: typeof import("./buySell") = await import("./buySell" + ".ts");
const G: typeof import("../shared/nameGuard") = await import("../shared/nameGuard" + ".ts");

const priced = (amount: number, extra: Record<string, unknown> = {}) => ({ status: "priced", amount, lines: [], source: { kind: "partner_ratecard", label: "Rate card" }, ...extra });
/** CaseView.marketSell from PriceIQ's live answer: a fresh week, with its age. */
const market = { amount: 21119, listing: 21999, markdownBp: 400, grade: "Good", gradeWanted: "Good", listings: 2, week: "2026-W41", ageDays: 6, stale: false, why: null };
/** The server's sentence about stale data (~/projects/swapup lib/domain/marketSell.ts), shown as sent. */
const STALE_NOTE = "Refurbished market price, week 2026-W35, 52 days old.";
/** The same phone priced off the data on file (week 2026-W35, 52 days old on 2026-10-18). */
const staleMarket = { ...market, week: "2026-W35", ageDays: 52, stale: true, note: STALE_NOTE };
/** An older server: no age, no staleness, and its own source tag the app never shows. */
const oldMarket = { amount: 21119, listing: 21999, markdownBp: 400, grade: "Good", gradeWanted: "Good", listings: 2, week: "2026-W35", why: null, source: "PriceIQ · refurbished market" };
const noMarket = { amount: null, why: "PriceIQ has no refurbished market price for the Galaxy S23 128GB." };

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

test("buy vs sell: the trade-in against PriceIQ's marked-down refurbished market price, with PriceIQ's week", () => {
  const m = B.priceCard(read(), "3200");
  assert.deepEqual(m.buy, { amount: 12000, note: null });
  assert.equal(m.sell.amount, 21119);
  assert.equal(m.sell.source, "Refurbished market price ₹21,999 (Good) − 4% · PriceIQ 2026-W41");
  assert.equal(m.sell.note, null, "fresh data: no age, no warning");
  assert.deepEqual(m.refurb, { amount: 3200, problem: null });
  assert.deepEqual(m.margin, { amount: 21119 - 12000 - 3200, note: null });
});

test("sell names a lower grade when the market listed none at the phone's own", () => {
  const m = B.priceCard(read({ marketSell: { ...market, grade: "Fair", gradeWanted: "Good" } }), "3200");
  assert.equal(m.sell.source, "Refurbished market price ₹21,999 (Fair) − 4% · PriceIQ 2026-W41 · none at Good");
  const old = B.priceCard(read({ marketSell: { ...staleMarket, note: null, grade: "Fair", gradeWanted: "Good" } }), "3200");
  assert.equal(old.sell.source, "Refurbished market price ₹21,999 (Fair) − 4% · PriceIQ 2026-W35, 52 days old · none at Good");
});

test("stale PriceIQ data (over 14 days) keeps its price and says its age once — in the server's note when it sends one", () => {
  const m = B.priceCard(read({ marketSell: staleMarket }), "3200");
  assert.equal(m.sell.amount, 21119);
  assert.equal(m.sell.source, "Refurbished market price ₹21,999 (Good) − 4% · PriceIQ 2026-W35");
  assert.equal(m.sell.note, STALE_NOTE);
  // No note from the server: the line carries the age, in the trade-in line's words.
  assert.deepEqual(B.sellFigure(read({ marketSell: { ...staleMarket, note: null } })), {
    amount: 21119,
    note: null,
    source: "Refurbished market price ₹21,999 (Good) − 4% · PriceIQ 2026-W35, 52 days old",
  });
  assert.equal(B.sellFigure(read({ marketSell: { ...market, ageDays: 1, stale: true } })).source, "Refurbished market price ₹21,999 (Good) − 4% · PriceIQ 2026-W41, 1 day old");
  // The server says stale without an age: the line still says it is old.
  assert.equal(B.sellFigure(read({ marketSell: { ...market, ageDays: undefined, stale: true } })).source, "Refurbished market price ₹21,999 (Good) − 4% · PriceIQ 2026-W41, over 14 days old");
});

test("the age limits: 14 days is fresh, 15 is shown with its age, 90 still prices, 91 is no price", () => {
  const sell = (ageDays: number, over: Record<string, unknown> = {}) => B.sellFigure(read({ marketSell: { ...market, ageDays, stale: undefined }, ...over }));
  assert.equal(sell(14).source, "Refurbished market price ₹21,999 (Good) − 4% · PriceIQ 2026-W41");
  assert.equal(sell(15).source, "Refurbished market price ₹21,999 (Good) − 4% · PriceIQ 2026-W41, 15 days old");
  assert.equal(sell(90).amount, 21119);
  assert.equal(sell(90).source, "Refurbished market price ₹21,999 (Good) − 4% · PriceIQ 2026-W41, 90 days old");
  // Over 90 days PriceIQ sets no price, whatever the server sent: the partner's repaired price, else the no-price line.
  assert.deepEqual(sell(91), { amount: 18500, note: null, source: "Partner's repaired price" });
  assert.deepEqual(sell(91, { repairedQuote: null }), { amount: null, note: B.NO_MARKET_PRICE, source: null });
  assert.equal(B.STALE_AFTER_DAYS, 14);
  assert.equal(B.NO_PRICE_AFTER_DAYS, 90);
});

test("PriceIQ unreachable: the server's last good answer stays, with its note as sent", () => {
  const note = "PriceIQ unreachable, last answer 2026-10-18 09:12 UTC.";
  const m = B.sellFigure(read({ marketSell: { ...market, note } }));
  assert.deepEqual(m, { amount: 21119, note, source: "Refurbished market price ₹21,999 (Good) − 4% · PriceIQ 2026-W41" });
  const both = `${STALE_NOTE.slice(0, -1)} · ${note}`;
  assert.equal(B.sellFigure(read({ marketSell: { ...staleMarket, note: both } })).note, both);
  // A blank or junk note is none.
  for (const bad of ["  ", "", 7, null]) assert.equal(B.sellFigure(read({ marketSell: { ...market, note: bad } })).note, null, JSON.stringify(bad));
});

test("an older server: no age fields and a source tag — read, with PriceIQ's week and nothing invented", () => {
  const m = B.priceCard(read({ marketSell: oldMarket }), "3200");
  assert.equal(m.sell.amount, 21119);
  assert.equal(m.sell.source, "Refurbished market price ₹21,999 (Good) − 4% · PriceIQ 2026-W35");
  assert.equal(m.sell.note, null);
  assert.equal(B.sellFigure(read({ marketSell: { ...oldMarket, week: undefined } })).source, "Refurbished market price ₹21,999 (Good) − 4% · PriceIQ");
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
  assert.equal(unpriced.note, "A part has no price — enter the refurb cost.");
  assert.equal(B.refurbStart(read({ repair: null })).note, "No repair estimate — enter the refurb cost.");
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
  assert.equal(m.buy.note, "No quote — storage missing.");
  assert.equal(m.sell.amount, null);
  assert.equal(m.margin.note, "Needs the buy price and the sell price.");
});

test("no price from anywhere: the server's reason, else the one no-price line — never a made-up figure", () => {
  const m = B.priceCard(read({ quote: { status: "unpriced", amount: null, reason: "The partner doesn't buy this model." } }), "3200");
  assert.deepEqual(m.buy, { amount: null, note: "The partner doesn't buy this model." });
  assert.equal(B.NO_MARKET_PRICE, "No market price yet — enter a quote.");
  assert.deepEqual(B.buyFigure(read({ quote: { status: "unpriced", amount: null } })), { amount: null, note: B.NO_MARKET_PRICE });
  assert.deepEqual(B.sellFigure(read({ marketSell: { amount: null, why: null }, repairedQuote: { status: "unpriced", amount: null } })), { amount: null, note: B.NO_MARKET_PRICE, source: null });
  assert.deepEqual(B.sellFigure(read({ marketSell: null, repairedQuote: null })), { amount: null, note: B.NO_MARKET_PRICE, source: null });
});

test("an expired quote keeps its number, with no second note (the answer's trade-in tile says it)", () => {
  assert.deepEqual(B.buyFigure(read({ quoteExpired: true })), { amount: 12000, note: null });
});

test("an older server's placeholder-card figure (source kind 'sample') is never used as the buy price", () => {
  // A server not yet upgraded (or rolled back) still quotes off its placeholder card: that trade-in
  // is no price, so BUY is empty with the one no-price line, and no margin is worked out from it.
  const legacyBuy = priced(12000, { source: { kind: "sample" } });
  assert.deepEqual(B.buyFigure(read({ quote: legacyBuy })), { amount: null, note: B.NO_MARKET_PRICE });
  // Whatever else the case holds: an expired one, or a PriceIQ sell price and a typed refurb cost.
  assert.deepEqual(B.buyFigure(read({ quote: legacyBuy, quoteExpired: true })), { amount: null, note: B.NO_MARKET_PRICE });
  const m = B.priceCard(read({ quote: legacyBuy }), "3200");
  assert.deepEqual(m.buy, { amount: null, note: B.NO_MARKET_PRICE });
  assert.equal(m.sell.amount, 21119);
  assert.deepEqual(m.margin, { amount: null, note: "Needs the buy price." });
  // Its reason is not shown either — a placeholder card's words are not the app's.
  const legacyUnpriced = { status: "unpriced", amount: null, reason: "Placeholder card: no row for this model.", source: { kind: "sample" } };
  assert.deepEqual(B.buyFigure(read({ quote: legacyUnpriced })), { amount: null, note: B.NO_MARKET_PRICE });
  // A real rate-card or PriceIQ trade-in is untouched.
  assert.deepEqual(B.buyFigure(read({ quote: priced(12000) })), { amount: 12000, note: null });
  assert.deepEqual(B.buyFigure(read({ quote: priced(12000, { source: { kind: "priceiq" } }) })), { amount: 12000, note: null });
});

test("an older server's placeholder-card figure (source kind 'sample') is never used as the sell price", () => {
  const legacy = priced(18500, { source: { kind: "sample" } });
  assert.deepEqual(B.sellFigure(read({ marketSell: noMarket, repairedQuote: legacy })), { amount: null, note: noMarket.why, source: null });
  assert.deepEqual(B.sellFigure(read({ marketSell: { amount: null, why: null }, repairedQuote: legacy })), { amount: null, note: B.NO_MARKET_PRICE, source: null });
  assert.equal(B.priceCard(read({ marketSell: noMarket, repairedQuote: legacy }), "3200").margin.note, "Needs the sell price.");
  // PriceIQ's own price is used whatever the repaired quote is.
  assert.equal(B.sellFigure(read({ repairedQuote: legacy })).amount, 21119);
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
    text: "Needs a bench diagnosis — enter the refurb cost.",
    bad: false,
  });
});

test("no line on the card names the buyback partner", () => {
  const lines = [
    B.sellFigure(read()).source,
    B.sellFigure(read({ marketSell: { ...market, grade: "Fair", gradeWanted: "Good" } })).source,
    B.sellFigure(read({ marketSell: staleMarket })).source,
    B.sellFigure(read({ marketSell: { ...staleMarket, note: null } })).source,
    B.sellFigure(read({ marketSell: noMarket })).source,
    B.NO_MARKET_PRICE,
  ];
  for (const l of lines) assert.equal(G.namesPartner(l ?? ""), false, String(l));
});

test("marginFigure: plain arithmetic, nulls named in order", () => {
  assert.deepEqual(B.marginFigure(10, 2, 15), { amount: 3, note: null });
  assert.deepEqual(B.marginFigure(null, null, null), { amount: null, note: "Needs the buy price, the refurb cost and the sell price." });
  assert.deepEqual(B.marginFigure(1, null, 2), { amount: null, note: "Needs the refurb cost." });
});
