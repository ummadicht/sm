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
  caseImei: null,
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
  // A single-SIM phone on the new case: IMEI 2 null (the case had no IMEI 1, so no IMEI 2 of its own); no name or mobile, an empty case.
  const g = fakeApi({ "POST /api/cases": { id: "case_1", status: "draft", imei: null }, "PATCH /api/cases/case_1": caseView(), "POST /api/test-sessions": LINKS });
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
  // Again, with the case: the customer and the IMEI are saved again (the server doesn't look it up twice), and the test starts.
  const g = fakeApi({ "PATCH /api/cases/case_1": caseView(), "POST /api/test-sessions": LINKS });
  assert.equal((await I.startTradeIn(g.api, input({ caseId: "case_1" }))).kind, "started");
  assert.deepEqual(g.calls.map((c) => `${c.method} ${c.path}`), ["PATCH /api/cases/case_1", "PATCH /api/cases/case_1", "POST /api/test-sessions"]);
  // Skipped after all: the test goes on the case already opened.
  const h = fakeApi({ "PATCH /api/cases/case_1": caseView(), "POST /api/test-sessions": LINKS });
  await I.startTradeIn(h.api, input({ imei: null, caseId: "case_1" }));
  assert.deepEqual(h.calls, [
    { method: "PATCH", path: "/api/cases/case_1", body: { customer: { name: "Ravi Kumar", phone: "9876543210" } } },
    { method: "POST", path: "/api/test-sessions", body: { caseId: "case_1" } },
  ]);
  // The IMEI refused (the server's words): no test, the case kept for the next try.
  const k = fakeApi({ "POST /api/cases": { id: "case_2", status: "draft" }, "PATCH /api/cases/case_2": new A.ApiError(400, "That isn't an IMEI.") });
  assert.deepEqual(await I.startTradeIn(k.api, input()), { kind: "failed", text: "That isn't an IMEI.", caseId: "case_2", caseView: null });
  // A create that answers with no case.
  const m = fakeApi({ "POST /api/cases": { ok: true } });
  assert.deepEqual(await I.startTradeIn(m.api, input()), { kind: "failed", text: "No case came back. Try again.", caseId: null, caseView: null });
});

/**
 * One case as the server keeps it (~/projects/swapup lib/server/cases.ts updateCase), on top of fakeApi:
 * IMEI 1 replaced when the patch names it, IMEI 2 ONLY when the patch names it (left out = kept), the
 * customer merged field by field (left out = kept, null = none). `test` answers POST /api/test-sessions.
 */
type ServerCase = { imei: string | null; imei2: string | null; customer: { name: string; phone: string } | null };
function caseServer(test: unknown = LINKS, start: Partial<ServerCase> = {}) {
  const state: ServerCase = { imei: null, imei2: null, customer: null, ...start };
  const view = () => caseView({ ...state, imeiLookup: state.imei ? lookup({ blacklist: state.imei === IMEI1 ? "blacklisted" : "clean" }) : null });
  const f = fakeApi({
    "POST /api/cases": (b: unknown) => {
      const { customerName, customerPhone } = (b ?? {}) as { customerName?: string; customerPhone?: string };
      state.customer = customerName || customerPhone ? { name: customerName ?? "", phone: customerPhone ?? "" } : null;
      return view();
    },
    "PATCH /api/cases/case_1": (b: unknown) => {
      const p = b as { imei?: string | null; imei2?: string | null; customer?: { name?: string; phone?: string } | null };
      if (p.imei !== undefined) state.imei = p.imei;
      if (p.imei2 !== undefined) state.imei2 = p.imei2;
      if (p.customer !== undefined)
        state.customer = p.customer ? { name: p.customer.name ?? state.customer?.name ?? "", phone: p.customer.phone ?? state.customer?.phone ?? "" } : null;
      return view();
    },
    "POST /api/test-sessions": test,
  });
  return { ...f, state };
}

test("Change IMEI 1 with no IMEI 2: the old phone's IMEI 2 goes with it; the same IMEI 1 saved again keeps its own", async () => {
  // The body: a new IMEI 1 (or a first one) with no IMEI 2 sends imei2 null; the case's own IMEI 1 again sends none.
  assert.deepEqual(I.imeiPatch({ imei: IMEI3, imei2: null }, IMEI1), { imei: IMEI3, imei2: null });
  assert.deepEqual(I.imeiPatch({ imei: IMEI3, imei2: null }, null), { imei: IMEI3, imei2: null });
  assert.deepEqual(I.imeiPatch({ imei: IMEI1, imei2: null }, IMEI1), { imei: IMEI1 }, "an IMEI 2 Apply copied in stays");
  assert.deepEqual(I.imeiPatch({ imei: IMEI3, imei2: IMEI2 }, IMEI1), { imei: IMEI3, imei2: IMEI2 });
  assert.deepEqual(I.imeiPatch({ imei: IMEI1, imei2: IMEI2 }, IMEI1), { imei: IMEI1, imei2: IMEI2 });

  // New trade-in: a dual-SIM phone scanned (IMEI1 + IMEI2) → GSMA stops it → Change → the right phone typed (IMEI 1 only).
  const s = caseServer();
  const first = await I.startTradeIn(s.api, input());
  assert.equal(first.kind, "stopped");
  assert.deepEqual([s.state.imei, s.state.imei2], [IMEI1, IMEI2]);
  const again = await I.startTradeIn(s.api, input({ caseId: "case_1", caseImei: IMEI1, imei: { imei: IMEI3, imei2: null } }));
  assert.equal(again.kind, "started");
  assert.deepEqual([s.state.imei, s.state.imei2], [IMEI3, null], "never this phone's IMEI 1 with another phone's IMEI 2");

  // The new IMEI 1 is the old IMEI 2: never IMEI 1 = IMEI 2 on the case.
  const t = caseServer(LINKS, { imei: IMEI1, imei2: IMEI2 });
  await I.startTradeIn(t.api, input({ caseId: "case_1", caseImei: IMEI1, imei: { imei: IMEI2, imei2: null } }));
  assert.deepEqual([t.state.imei, t.state.imei2], [IMEI2, null]);

  // Saved again as it was (a retry after the test failed): the case's IMEI 2 is left alone.
  const u = caseServer(LINKS, { imei: IMEI3, imei2: IMEI2 });
  await I.startTradeIn(u.api, input({ caseId: "case_1", caseImei: IMEI3, imei: { imei: IMEI3, imei2: null } }));
  assert.deepEqual([u.state.imei, u.state.imei2], [IMEI3, IMEI2]);
  // The case's IMEI not known (the last save never answered): IMEI 2 is cleared, never assumed the same phone's.
  const w = caseServer(LINKS, { imei: IMEI3, imei2: IMEI2 });
  await I.startTradeIn(w.api, input({ caseId: "case_1", caseImei: null, imei: { imei: IMEI3, imei2: null } }));
  assert.deepEqual([w.state.imei, w.state.imei2], [IMEI3, null]);
});

test("Start again on the same case: the name and mobile as they are now go on the case before the test", async () => {
  const wifi = new A.ApiError(0, "No answer — check the Wi‑Fi.");
  const phone3 = { imei: IMEI3, imei2: null };
  // The first Start opens the case with the customer, then the test times out.
  let tries = 0;
  const s = caseServer(() => (tries++ ? LINKS : wifi));
  assert.equal((await I.startTradeIn(s.api, input({ imei: phone3 }))).kind, "failed");
  assert.deepEqual(s.state.customer, { name: "Ravi Kumar", phone: "9876543210" });
  // The advisor corrects the mobile and the name, and taps Start again: they reach the case first.
  s.calls.length = 0;
  const again = await I.startTradeIn(s.api, input({ caseId: "case_1", caseImei: IMEI3, imei: phone3, customerName: " Ravi Kumar Rao ", customerPhone: "9876501234" }));
  assert.equal(again.kind, "started");
  assert.deepEqual(s.state.customer, { name: "Ravi Kumar Rao", phone: "9876501234" });
  assert.deepEqual(s.calls, [
    { method: "PATCH", path: "/api/cases/case_1", body: { customer: { name: "Ravi Kumar Rao", phone: "9876501234" } } },
    { method: "PATCH", path: "/api/cases/case_1", body: { imei: IMEI3 }, timeoutMs: I.IMEI_SAVE_MS },
    { method: "POST", path: "/api/test-sessions", body: { caseId: "case_1" } },
  ]);

  // Skipped after a stop (the IMEI at hand-over): a mobile left empty the first time is added too.
  const t = caseServer(LINKS, { imei: IMEI3, customer: { name: "Ravi Kumar", phone: "" } });
  await I.startTradeIn(t.api, input({ caseId: "case_1", caseImei: IMEI3, imei: null }));
  assert.deepEqual(t.state.customer, { name: "Ravi Kumar", phone: "9876543210" });
  assert.deepEqual(t.calls.map((c) => `${c.method} ${c.path}`), ["PATCH /api/cases/case_1", "POST /api/test-sessions"]);
  // A mobile cleared stays cleared; both cleared, the case has no customer (as a new one with neither).
  const u = caseServer(LINKS, { customer: { name: "Ravi Kumar", phone: "9876543210" } });
  await I.startTradeIn(u.api, input({ caseId: "case_1", imei: null, customerPhone: null }));
  assert.deepEqual(u.state.customer, { name: "Ravi Kumar", phone: "" });
  await I.startTradeIn(u.api, input({ caseId: "case_1", imei: null, customerName: "  ", customerPhone: null }));
  assert.equal(u.state.customer, null);
  assert.deepEqual(u.calls.at(-2)?.body, { customer: null });

  // The customer save itself fails: no IMEI save, no test, the case kept for the next try.
  const k = fakeApi({ "PATCH /api/cases/case_1": wifi, "POST /api/test-sessions": LINKS });
  assert.deepEqual(await I.startTradeIn(k.api, input({ caseId: "case_1" })), { kind: "failed", text: "No answer — check the Wi‑Fi.", caseId: "case_1", caseView: null });
  assert.equal(k.calls.length, 1);
});

test("a failed read: the server's own sentence; a server without the reader says it is off", () => {
  assert.equal(I.readFailText(new A.ApiError(503, I.READER_OFF, "reader_off")), I.READER_OFF);
  assert.equal(I.readFailText(new A.ApiError(422, I.NOTHING_READ, "not_found")), I.NOTHING_READ);
  assert.equal(I.readFailText(new A.ApiError(404, "Request failed (404)")), "The screen reader is off — scan or type the IMEI.");
  assert.equal(I.readFailText(new A.ApiError(0, "No answer — check the Wi‑Fi.")), "No answer — check the Wi‑Fi.");
});

test("ApiError carries the server's reason", () => {
  const e = new A.ApiError(503, "The screen reader is off — scan or type the IMEI.", "reader_off");
  assert.equal(e.reason, "reader_off");
  assert.equal(new A.ApiError(400, "x").reason, null);
});

test("the card's own words: one short sentence each", () => {
  const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  for (const s of [I.NOT_AN_IMEI, I.NOTHING_READ, I.READER_OFF, ...Object.values(I.BLACKLIST_TEXT)]) {
    assert.ok(words(s) <= 15, s);
    assert.equal(1 + (s.match(/[.!?…]\s+[A-Z]/g) ?? []).length, 1, s);
  }
});
