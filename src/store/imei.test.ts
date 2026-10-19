// node --test --experimental-strip-types --no-warnings src/store/imei.test.ts
// IMEI FIRST: the scan rule, the reader's answer, what the server found and the Start sequence
// (contract: ~/projects/swapup docs/MOBILE-API.md, IMEI first). Same import trick as ./offer.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// imei.ts imports ./lock, ./phoneLed and ../shared/api without an extension (Metro's way); this adds ".ts" for plain node.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); }
        catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]sx?$/.test(s)) return next(s + ".ts", c); throw e; }
      }`
    )
);

const I: typeof import("./imei") = await import("./imei" + ".ts");
const A: typeof import("../shared/api") = await import("../shared/api" + ".ts");
const P: typeof import("./phoneLed") = await import("./phoneLed" + ".ts");

// Two Luhn-valid IMEIs of one dual-SIM phone, a third, and one that fails its check digit.
const IMEI1 = "356789012345672";
const IMEI2 = "356789012345680";
const BAD = "356789012345673";
const IMEI3 = "356789012345698";

test("fixtures: three IMEIs that pass the check digit, one that doesn't", () => {
  assert.equal(P.imeiCheck(IMEI1), "ok");
  assert.equal(P.imeiCheck(IMEI2), "ok");
  assert.equal(P.imeiCheck(IMEI3), "ok");
  assert.equal(P.imeiCheck(BAD), "bad");
});

test("the barcodes the camera looks for", () => {
  assert.deepEqual([...I.IMEI_BARCODE_TYPES], ["code128", "code39", "ean13", "itf14", "datamatrix", "qr"]);
});

test("imeisIn: a Luhn-valid 15-digit run inside the text, at most two, in order", () => {
  assert.deepEqual(I.imeisIn(IMEI1), [IMEI1]);
  assert.deepEqual(I.imeisIn(`IMEI ${IMEI1}`), [IMEI1]);
  // A label with a digit in it is its own run: "IMEI1" never joins the number.
  assert.deepEqual(I.imeisIn(`IMEI1:${IMEI1};IMEI2:${IMEI2}`), [IMEI1, IMEI2]);
  assert.deepEqual(I.imeisIn(`${IMEI1}\n${IMEI1}`), [IMEI1], "the same one twice is one");
  assert.deepEqual(I.imeisIn(`${IMEI1} ${IMEI2} ${IMEI3}`), [IMEI1, IMEI2], "never more than two");
  // Printed in groups on a box label.
  assert.deepEqual(I.imeisIn("35-678901-234567-2"), [IMEI1]);
  assert.deepEqual(I.imeisIn("35 678901 234567 2"), [IMEI1]);
});

test("imeisIn: nothing that fails the check digit, and no window slid along a longer run", () => {
  assert.deepEqual(I.imeisIn(BAD), []);
  assert.deepEqual(I.imeisIn(""), []);
  assert.deepEqual(I.imeisIn("R5CT1234ABC"), [], "a serial number");
  assert.deepEqual(I.imeisIn("8801234567890"), [], "an EAN-13");
  assert.deepEqual(I.imeisIn("35678901234567"), [], "14 digits");
  // An EID (32 digits) whose first 15 digits happen to pass the check digit: still not an IMEI.
  const eid = `${IMEI1}00000000000000000`;
  assert.equal(eid.length, 32);
  assert.equal(P.imeiCheck(eid.slice(0, 15)), "ok");
  assert.deepEqual(I.imeisIn(eid), []);
  // An IMEISV (16 digits) is not slid along either.
  assert.deepEqual(I.imeisIn(`${IMEI1}1`), []);
  // A long run beside a real IMEI doesn't hide it.
  assert.deepEqual(I.imeisIn(`EID ${eid} IMEI ${IMEI2}`), [IMEI2]);
});

test("takeScan: IMEI 1 first, a second distinct one is IMEI 2; the note only while nothing is found", () => {
  let s = I.NOTHING_SCANNED;
  let r = I.takeScan(s, "R5CT1234ABC");
  assert.deepEqual(r, { next: s, note: I.NOT_AN_IMEI });
  r = I.takeScan(s, IMEI1);
  assert.deepEqual(r, { next: { imei: IMEI1, imei2: null }, note: null });
  s = r.next;
  // The camera keeps seeing IMEI 1, and the serial beside it: nothing changes (the same object), nothing said.
  assert.deepEqual(I.takeScan(s, IMEI1), { next: s, note: null });
  assert.equal(I.takeScan(s, IMEI1).next, s);
  assert.equal(I.takeScan(s, "R5CT1234ABC").next, s);
  assert.equal(I.takeScan(s, "R5CT1234ABC").note, null);
  r = I.takeScan(s, IMEI2);
  assert.deepEqual(r.next, { imei: IMEI1, imei2: IMEI2 });
  // Once both are in, a third never replaces either.
  assert.deepEqual(I.takeScan(r.next, IMEI3).next, { imei: IMEI1, imei2: IMEI2 });
  // One code with both numbers (a QR): both at once.
  assert.deepEqual(I.takeScan(I.NOTHING_SCANNED, `IMEI1 ${IMEI1} IMEI2 ${IMEI2}`).next, { imei: IMEI1, imei2: IMEI2 });
});

test("readImeiRead: the reader's answer, its check digit checked again here", () => {
  assert.deepEqual(I.readImeiRead({ imei: IMEI1, imei2: IMEI2, valid: true }), { imei: IMEI1, imei2: IMEI2, valid: true });
  assert.deepEqual(I.readImeiRead({ imei: IMEI1, imei2: null, valid: true }), { imei: IMEI1, imei2: null, valid: true });
  // A misread: kept for the advisor to correct, never marked valid (whatever the server says).
  assert.deepEqual(I.readImeiRead({ imei: BAD, imei2: null, valid: true }), { imei: BAD, imei2: null, valid: false });
  assert.deepEqual(I.readImeiRead({ imei: "3567890123456", imei2: null, valid: false }), { imei: "3567890123456", imei2: null, valid: false });
  // A bad or repeated IMEI 2 is dropped (it is optional, and never trusted unchecked).
  assert.equal(I.readImeiRead({ imei: IMEI1, imei2: BAD, valid: true })!.imei2, null);
  assert.equal(I.readImeiRead({ imei: IMEI1, imei2: IMEI1, valid: true })!.imei2, null);
  for (const none of [null, {}, { imei: null }, { imei: "" }, { imei: "no digits" }, "x"]) assert.equal(I.readImeiRead(none), null, JSON.stringify(none));
});

const lookup = (over: Partial<import("./imei").ImeiLookup> = {}): import("./imei").ImeiLookup => ({
  brand: "Samsung",
  model: "Galaxy S23 Ultra",
  modelNumber: "SM-S918B",
  blacklist: "clean",
  source: "gsma",
  at: "2026-10-19T10:00:00.000Z",
  ...over,
});

test("imeiResultLine: the model and the GSMA word; not checked is never said as clean", () => {
  assert.equal(I.imeiResultLine(lookup()), "Galaxy S23 Ultra · not blacklisted (GSMA)");
  assert.equal(I.imeiResultLine(lookup({ blacklist: "unknown" })), "Galaxy S23 Ultra · Blacklist not checked");
  assert.equal(I.imeiResultLine(lookup({ blacklist: "blacklisted" })), "Galaxy S23 Ultra · reported lost or stolen (GSMA)");
  assert.equal(I.imeiResultLine(lookup({ model: null })), "Samsung · not blacklisted (GSMA)");
  assert.equal(I.imeiResultLine(lookup({ model: null, brand: null })), "Not blacklisted (GSMA)");
  assert.equal(I.imeiResultLine(lookup({ model: null, brand: null, blacklist: "unknown" })), "Blacklist not checked");
  assert.equal(I.imeiResultLine(null), null);
  // An unreadable blacklist word reads as not checked.
  assert.equal(I.imeiResultLine(I.readImeiLookup({ model: "Galaxy A54", blacklist: "No" })), "Galaxy A54 · Blacklist not checked");
});

test("imeiStop: GSMA blacklisted, or an early KYM answer that isn't clear, stops the trade-in", () => {
  assert.equal(I.imeiStop({ imeiLookup: lookup(), kymEarly: null }), null);
  assert.equal(I.imeiStop({ imeiLookup: lookup({ blacklist: "unknown" }), kymEarly: null }), null);
  assert.equal(I.imeiStop({ imeiLookup: null, kymEarly: { status: "clear", reference: null } }), null);
  assert.equal(I.imeiStop({ imeiLookup: lookup({ blacklist: "blacklisted" }), kymEarly: null }), "This phone is reported lost or stolen (GSMA). It can't be traded in.");
  for (const status of ["blacklisted", "duplicate", "in_use"] as const) {
    assert.equal(I.imeiStop({ imeiLookup: lookup(), kymEarly: { status, reference: null } }), "This phone is reported lost or stolen. It can't be traded in.", status);
  }
});

// ── Start ────────────────────────────────────────────────────────────────────

type Call = { method: "POST" | "PATCH"; path: string; body: unknown; timeoutMs?: number };

/** A fake staff client: answers by "METHOD path", records every call. */
function fakeApi(answers: Record<string, unknown | ((body: unknown) => unknown)>) {
  const calls: Call[] = [];
  const answer = async (method: Call["method"], path: string, body: unknown, opts?: { timeoutMs?: number }) => {
    calls.push({ method, path, body, ...(opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
    const a = answers[`${method} ${path}`];
    if (a === undefined) throw new A.ApiError(404, `No route ${method} ${path}`);
    const v = typeof a === "function" ? (a as (b: unknown) => unknown)(body) : a;
    if (v instanceof Error) throw v;
    return v as never;
  };
  return {
    calls,
    api: {
      post: <T,>(path: string, body?: unknown, opts?: { timeoutMs?: number }) => answer("POST", path, body, opts) as Promise<T>,
      patch: <T,>(path: string, body: unknown, opts?: { timeoutMs?: number }) => answer("PATCH", path, body, opts) as Promise<T>,
    },
  };
}

const LINKS = { session: { id: "ts_1", caseId: "case_1", status: "waiting" }, joinUrl: "https://x/j/ABC123", wifi: null };
const caseView = (over: Record<string, unknown> = {}) => ({ id: "case_1", ref: "SU-AND-00140", status: "draft", imei: IMEI1, imeiLookup: lookup(), imeiWarnings: [], kymEarly: null, ...over });
const input = (over: Partial<import("./imei").StartInput> = {}): import("./imei").StartInput => ({
  customerName: "  Ravi Kumar ",
  customerPhone: "9876543210",
  imei: { imei: IMEI1, imei2: IMEI2 },
  caseId: null,
  ...over,
});

test("Start with an IMEI: open the case, save the IMEI (and IMEI 2), then the test on that case", async () => {
  const f = fakeApi({
    "POST /api/cases": { id: "case_1", ref: "SU-AND-00140", status: "draft" },
    "PATCH /api/cases/case_1": caseView(),
    "POST /api/test-sessions": LINKS,
  });
  const r = await I.startTradeIn(f.api, input());
  assert.deepEqual(r, { kind: "started", links: LINKS });
  assert.deepEqual(f.calls, [
    { method: "POST", path: "/api/cases", body: { customerName: "Ravi Kumar", customerPhone: "9876543210" } },
    { method: "PATCH", path: "/api/cases/case_1", body: { imei: IMEI1, imei2: IMEI2 }, timeoutMs: I.IMEI_SAVE_MS },
    { method: "POST", path: "/api/test-sessions", body: { caseId: "case_1" } },
  ]);
  // A single-SIM phone sends imei2 null; no name or mobile, an empty case.
  const g = fakeApi({ "POST /api/cases": { id: "case_1", status: "draft" }, "PATCH /api/cases/case_1": caseView(), "POST /api/test-sessions": LINKS });
  await I.startTradeIn(g.api, input({ customerName: " ", customerPhone: null, imei: { imei: IMEI1, imei2: null } }));
  assert.deepEqual(g.calls[0].body, {});
  assert.deepEqual(g.calls[1].body, { imei: IMEI1, imei2: null });
});

test("Start skipped (scan at hand-over): today's one call with the customer", async () => {
  const f = fakeApi({ "POST /api/test-sessions": LINKS });
  assert.deepEqual(await I.startTradeIn(f.api, input({ imei: null })), { kind: "started", links: LINKS });
  assert.deepEqual(f.calls, [{ method: "POST", path: "/api/test-sessions", body: { customerName: "Ravi Kumar", customerPhone: "9876543210" } }]);
  // Nothing scanned counts as skipped too.
  const g = fakeApi({ "POST /api/test-sessions": LINKS });
  await I.startTradeIn(g.api, input({ imei: I.NOTHING_SCANNED, customerPhone: null }));
  assert.deepEqual(g.calls, [{ method: "POST", path: "/api/test-sessions", body: { customerName: "Ravi Kumar" } }]);
});

test("Start stops before the test when the phone is blacklisted — GSMA, or the server's 409", async () => {
  const gsma = caseView({ imeiLookup: lookup({ blacklist: "blacklisted" }) });
  const f = fakeApi({ "POST /api/cases": { id: "case_1", status: "draft" }, "PATCH /api/cases/case_1": gsma, "POST /api/test-sessions": LINKS });
  assert.deepEqual(await I.startTradeIn(f.api, input()), { kind: "stopped", text: I.STOP_GSMA, caseId: "case_1", caseView: gsma });
  assert.ok(!f.calls.some((c) => c.path === "/api/test-sessions"), "no test starts");

  const sentence = "This phone is reported lost or stolen. It can't be traded in.";
  const g = fakeApi({
    "POST /api/cases": { id: "case_1", status: "draft" },
    "PATCH /api/cases/case_1": caseView(),
    "POST /api/test-sessions": new A.ApiError(409, sentence, "blacklisted"),
  });
  const r = await I.startTradeIn(g.api, input());
  assert.equal(r.kind, "stopped");
  assert.equal(r.kind === "stopped" && r.text, sentence);
  // Another 409 (not a blacklist) is an ordinary refusal, in the server's words.
  const h = fakeApi({ "POST /api/test-sessions": new A.ApiError(409, "The store's credit line is full.") });
  assert.deepEqual(await I.startTradeIn(h.api, input({ imei: null })), { kind: "failed", text: "The store's credit line is full.", caseId: null, caseView: null });
});

test("Start again after a failure: the same case, never a second one", async () => {
  // The IMEI saved, the test refused (say, a timeout).
  const f = fakeApi({
    "POST /api/cases": { id: "case_1", status: "draft" },
    "PATCH /api/cases/case_1": caseView(),
    "POST /api/test-sessions": new A.ApiError(0, "No answer — check the Wi‑Fi."),
  });
  const r = await I.startTradeIn(f.api, input());
  assert.equal(r.kind, "failed");
  assert.equal(r.kind === "failed" && r.caseId, "case_1");
  assert.deepEqual(r.kind === "failed" && r.caseView, caseView());
  // Again, with the case: the IMEI is saved again (the server doesn't look it up twice), and the test starts.
  const g = fakeApi({ "PATCH /api/cases/case_1": caseView(), "POST /api/test-sessions": LINKS });
  assert.equal((await I.startTradeIn(g.api, input({ caseId: "case_1" }))).kind, "started");
  assert.deepEqual(g.calls.map((c) => `${c.method} ${c.path}`), ["PATCH /api/cases/case_1", "POST /api/test-sessions"]);
  // Skipped after all: the test goes on the case already opened.
  const h = fakeApi({ "POST /api/test-sessions": LINKS });
  await I.startTradeIn(h.api, input({ imei: null, caseId: "case_1" }));
  assert.deepEqual(h.calls, [{ method: "POST", path: "/api/test-sessions", body: { caseId: "case_1" } }]);
  // The IMEI refused (the server's words): no test, the case kept for the next try.
  const k = fakeApi({ "POST /api/cases": { id: "case_2", status: "draft" }, "PATCH /api/cases/case_2": new A.ApiError(400, "That isn't an IMEI.") });
  assert.deepEqual(await I.startTradeIn(k.api, input()), { kind: "failed", text: "That isn't an IMEI.", caseId: "case_2", caseView: null });
  // A create that answers with no case.
  const m = fakeApi({ "POST /api/cases": { ok: true } });
  assert.deepEqual(await I.startTradeIn(m.api, input()), { kind: "failed", text: "No case came back. Try again.", caseId: null, caseView: null });
});

test("ApiError carries the server's reason", () => {
  const e = new A.ApiError(503, "The screen reader is off — scan or type the IMEI.", "reader_off");
  assert.equal(e.reason, "reader_off");
  assert.equal(new A.ApiError(400, "x").reason, null);
});

test("the card's own words: one short sentence each", () => {
  const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  for (const s of [I.NOT_AN_IMEI, I.NOTHING_READ, ...Object.values(I.BLACKLIST_TEXT)]) {
    assert.ok(words(s) <= 15, s);
    assert.equal(1 + (s.match(/[.!?…]\s+[A-Z]/g) ?? []).length, 1, s);
  }
});
