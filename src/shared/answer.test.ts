// node --test --experimental-strip-types --no-warnings src/shared/answer.test.ts
// Reading THE ANSWER the server writes (./answer.ts): the contract fixtures F1–F10 (./answer.fixtures.ts),
// an older server, and junk. Same import trick as ../store/buySell.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const A: typeof import("./answer") = await import("./answer" + ".ts");
const F: typeof import("./answer.fixtures") = await import("./answer.fixtures" + ".ts");
const PG: typeof import("../store/programme") = await import("../store/programme" + ".ts");

const view = (x: unknown) => {
  const v = A.readAnswer(x);
  assert.ok(v, "should read as an answer");
  return v;
};
const keys = (v: { lines?: { key: string }[] } | null | undefined) => (v && "lines" in v && v.lines ? v.lines.map((l) => l.key) : []);

test("F1: the customer's ready answer reads whole — headline, the five lines in the server's order, word for word", () => {
  assert.deepEqual(A.readAnswer(F.F1), { ready: true, final: false, headline: "An upgrade is worth considering", lines: F.F1.lines, test: false });
});

test("F2: not priced yet — the one waiting sentence, no figures", () => {
  assert.deepEqual(A.readAnswer(F.F2), { ready: false, final: false, text: "The advisor is working out your price.", test: false });
  assert.deepEqual(A.readAnswer(F.F2_ESTIMATE), { ready: false, final: false, text: "The advisor is confirming your price.", test: false });
});

test("F3/F10: traded in — final, the paid wording, no repair line", () => {
  const v = view(F.F3);
  assert.equal(v.final, true);
  assert.ok(v.ready && v.headline === "Traded in");
  assert.deepEqual(keys(v), ["grade", "market", "we_pay", "bonus"]);
  assert.ok(v.ready && v.lines[2].text === "We paid you ₹26,000");
  assert.ok(v.ready && v.lines[3].text === "+ ₹6,199 bonus with the Galaxy S26 Ultra 256GB");
  assert.equal(F.F10, F.F3);
});

test("F4: a covered repair — free, amount 0, the covered headline", () => {
  const v = view(F.F4);
  assert.ok(v.ready);
  assert.equal(v.headline, "Repair it — it's covered");
  assert.deepEqual(A.lineOf(v.lines, "repair"), { key: "repair", text: "or repair it free — covered by warranty", note: null, amount: 0 });
  assert.deepEqual(A.lineOf(v.lines, "grade"), { key: "grade", text: "Current grade A", note: "screen cracked", amount: null });
});

test("F5: nothing to repair, no campaign — grade, market and we-pay only", () => {
  const v = view(F.F5);
  assert.ok(v.ready);
  assert.equal(v.headline, "Nothing to repair — a straight trade-in");
  assert.deepEqual(keys(v), ["grade", "market", "we_pay"]);
  assert.equal(A.lineOf(v.lines, "bonus"), null);
});

test("F6: the staff answer — the same lines; the staff notes read; nothing staff-only reaches the view", () => {
  assert.deepEqual(A.readAnswer(F.F6), A.readAnswer(F.F1), "the customer's view of the staff answer is F1's");
  assert.deepEqual(A.readStaffAnswer(F.F6), { ready: true, final: false, headline: F.F1.headline, lines: F.F1.lines, text: null, test: false });
  assert.deepEqual(A.readStaffNotes(F.F6), { market: null, we_pay: "Includes ₹1,000 SwapUp premium (4%).", bonus: "Upgrade bonus · 4%" });
  // The view holds the lines only: no source, premium, bp, phone price or staff notes.
  assert.deepEqual(Object.keys(view(F.F6)).sort(), ["final", "headline", "lines", "ready", "test"]);
  assert.doesNotMatch(JSON.stringify(view(F.F6)), /premium|154999|partner_manual|staffNotes|"bp"/);
  // F6's swap, the same numbers: we pay = market + premium; total = we pay + bonus; the customer pays the rest.
  assert.equal(F.F6_SWAP.wePay, F.F6_SWAP.tradeIn + F.F6_SWAP.premium.amount);
  assert.equal(F.F6_SWAP.total, F.F6_SWAP.wePay + 6199);
  assert.equal(F.F6_SWAP.customerPays, 154999 - F.F6_SWAP.total);
});

test("F7: an older server sends no answer — undefined, so the screens stay as they were", () => {
  assert.equal(A.readAnswer((F.F7_STATUS as { answer?: unknown }).answer), undefined);
  assert.equal(A.readAnswer(undefined), undefined);
  assert.equal(A.readStaffAnswer(undefined), null);
  assert.deepEqual(A.readStaffNotes(undefined), { market: null, we_pay: null, bonus: null });
});

test("F8: staff, not ready — the customer waits, the advisor keeps the lines and the reason", () => {
  assert.deepEqual(A.readAnswer(F.F8), F.F2_ESTIMATE);
  const s = A.readStaffAnswer(F.F8)!;
  assert.equal(s.ready, false);
  assert.equal(s.text, "The advisor is confirming your price.");
  assert.deepEqual(s.lines, F.F1.lines);
  assert.equal(A.readStaffNotes(F.F8).market, "Estimate from the refurbished market — enter the buyback partner's quote to show it to the customer.");
});

test("F9: the repair chosen — final, grade and the repair; no we-pay line is still an answer", () => {
  const v = view(F.F9);
  assert.ok(v.ready);
  assert.equal(v.headline, "Repair chosen");
  assert.deepEqual(v.lines.map((l) => [l.key, l.text]), [["grade", "Current grade C"], ["repair", "Repair ₹34,096"]]);
});

test("which line keys each status carries (R10's table)", () => {
  for (const row of F.LINE_KEYS_BY_STATUS) assert.deepEqual(keys(view(row.answer)), row.keys, row.status);
  assert.deepEqual(A.readAnswer(F.CANCELLED), { ready: false, final: true, text: "This trade-in was cancelled.", test: false });
  assert.equal(view(F.WALKED_AWAY).final, true);
});

test("a test programme: the flag is read, only an explicit true", () => {
  assert.equal(view({ ...F.F1, test: true }).test, true);
  assert.equal(view({ ...F.F2, test: true }).test, true);
  for (const t of [1, "true", null, undefined]) assert.equal(view({ ...F.F1, test: t }).test, false, String(t));
  assert.equal(A.TEST_PROGRAMME, "Test programme — no real money");
  assert.equal(A.TEST_PROGRAMME, PG.TEST_PROGRAMME, "the store app's banner says the same");
});

test("the server's order is kept; a line kind this app doesn't know is dropped; a key twice keeps its first", () => {
  const shuffled = [F.F1.lines[4], F.F1.lines[0], F.F1.lines[2]];
  assert.deepEqual(keys(view({ ...F.F1, lines: shuffled })), ["repair", "grade", "we_pay"]);
  const newer = [{ key: "trade_in_v2", text: "Something new", note: null, amount: 1 }, ...F.F1.lines];
  assert.deepEqual(view({ ...F.F1, lines: newer }), view(F.F1));
  const twice = [...F.F1.lines, { key: "we_pay", text: "We pay you ₹99,999", note: null, amount: 99999 }];
  const once = view({ ...F.F1, lines: twice });
  assert.ok(once.ready);
  assert.equal(A.lineOf(once.lines, "we_pay")?.amount, 26000);
  assert.equal(once.lines.length, 5);
});

test("a note or an amount that isn't one reads as none; the words are trimmed", () => {
  const v = view({ ...F.F1, lines: [{ key: "we_pay", text: "  We pay you ₹26,000 ", note: 7, amount: "26000" }, { key: "grade", text: "Current grade C", note: "  ", amount: Infinity }] });
  assert.ok(v.ready);
  assert.deepEqual(v.lines, [
    { key: "we_pay", text: "We pay you ₹26,000", note: null, amount: null },
    { key: "grade", text: "Current grade C", note: null, amount: null },
  ]);
});

test("junk is null, never a throw — and never half an offer", () => {
  const bad: unknown[] = [
    null,
    "answer",
    3,
    [],
    {},
    { ready: "yes", headline: "x", lines: F.F1.lines },
    { ...F.F1, headline: undefined },
    { ...F.F1, headline: "   " },
    { ...F.F1, lines: [] },
    { ...F.F1, lines: "grade" },
    { ...F.F1, lines: undefined },
    { ...F.F1, lines: [{ key: "trade_in_v2", text: "Something new" }] },
    { ...F.F1, lines: [...F.F1.lines.slice(0, 2), { key: "we_pay", note: null, amount: 26000 }] },
    { ...F.F1, lines: [...F.F1.lines, null] },
    { ...F.F1, lines: [...F.F1.lines, { text: "no key" }] },
    { ready: false, final: false, test: false },
    { ready: false, text: "   " },
  ];
  for (const b of bad) assert.equal(A.readAnswer(b), null, JSON.stringify(b));
  for (const b of [null, "x", [], {}, { ready: 1, lines: [] }, { ready: true, lines: "x" }, { ready: true, lines: [{ key: "grade" }] }]) assert.equal(A.readStaffAnswer(b), null, JSON.stringify(b));
  // A staff answer with no lines yet (no condition, no price) is still the server's answer.
  assert.deepEqual(A.readStaffAnswer({ ready: false, text: "The advisor is working out your price.", lines: [] }), { ready: false, final: false, headline: null, lines: [], text: "The advisor is working out your price.", test: false });
  // Random shapes never throw.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const atoms = [null, undefined, 0, -1, 1.5, "", "x", true, false, [], {}, { key: "grade" }, { key: "we_pay", text: "We pay you ₹1" }];
  for (let i = 0; i < 500; i++) {
    const pick = () => atoms[Math.floor(rnd() * atoms.length)];
    const x = { ready: pick(), final: pick(), headline: pick(), text: pick(), test: pick(), lines: rnd() < 0.5 ? pick() : [pick(), pick()], staffNotes: pick() };
    assert.doesNotThrow(() => {
      A.readAnswer(x);
      A.readStaffAnswer(x);
      A.readStaffNotes(x);
    });
  }
});

test("answerSide: the side the customer's headline recommends — any other headline, neither", () => {
  const table: [string, "repair" | "swap" | null][] = [
    ["Repair it — it's covered", "repair"],
    ["Repair recommended", "repair"],
    ["Repair chosen", "repair"],
    ["An upgrade is worth considering", "swap"],
    ["Traded in", "swap"],
    ["Either works — your choice", null],
    ["Nothing to repair — a straight trade-in", null],
    ["Your offer", null],
    ["Something a newer server says", null],
  ];
  for (const [h, side] of table) assert.equal(A.answerSide(h), side, h);
  assert.equal(A.answerSide(null), null);
  assert.equal(A.answerSide(undefined), null);
});
