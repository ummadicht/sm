// node --test --experimental-strip-types --no-warnings src/check/report.test.ts
// The Check app's result screen (./ResultScreen.tsx, native and browser alike): the link to the grade
// report (grading spec §5), the SwapUp grade as the server wrote it, and — once the store applied the
// results — the facts, the heading, the clear-your-phone card and how often it reads the answer again
// (answer spec §F2/§F4). Same import trick as ./identify.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// report.ts imports its siblings without an extension (Metro's way); this adds ".ts" for plain node.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); }
        catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]sx?$/.test(s)) return next(s + ".ts", c); throw e; }
      }`
    )
);

const R: typeof import("./report") = await import("./report" + ".ts");
const A: typeof import("../shared/answer") = await import("../shared/answer" + ".ts");
const F: typeof import("../shared/answer.fixtures") = await import("../shared/answer.fixtures" + ".ts");

const SERVER = "https://swapup.example.in";
const applied = (over: Record<string, unknown> = {}) => ({
  status: "applied",
  caseRef: "SU-AND-00023",
  reportPath: "/r/AbC123_-xyz",
  grading: { status: "graded", label: "Good (B)", grade: "Good", letter: "B", final: true },
  ...over,
});

test("customerReport: once applied, the report on the store's server and the SwapUp grade", () => {
  assert.deepEqual(R.customerReport(applied(), SERVER), { url: "https://swapup.example.in/r/AbC123_-xyz", grade: "Good (B)" });
  // A trailing slash on the server, a version on the path.
  assert.deepEqual(R.customerReport(applied({ reportPath: "/r/tok?v=2" }), SERVER + "/"), { url: "https://swapup.example.in/r/tok?v=2", grade: "Good (B)" });
  // The server's own absolute address is kept.
  assert.equal(R.customerReport(applied({ reportPath: "https://public.example.in/r/tok" }), SERVER)?.url, "https://public.example.in/r/tok");
});

test("customerReport: nothing before the store applies, and nothing without a usable link", () => {
  for (const status of ["waiting", "joined", "testing", "complete", "expired", "cancelled"]) assert.equal(R.customerReport(applied({ status }), SERVER), null, status);
  for (const reportPath of [undefined, null, "", "r/tok", "//evil.example/r/tok", "javascript:alert(1)", "/r/to k", 7]) {
    assert.equal(R.customerReport(applied({ reportPath }), SERVER), null, String(reportPath));
  }
  for (const bad of [null, undefined, "applied", [], {}]) assert.equal(R.customerReport(bad, SERVER), null, JSON.stringify(bad));
});

test("customerReport: an older server sends the link without the grade — the link alone", () => {
  assert.deepEqual(R.customerReport(applied({ grading: undefined }), SERVER), { url: "https://swapup.example.in/r/AbC123_-xyz", grade: null });
  assert.equal(R.customerReport(applied({ grading: { status: "graded" } }), SERVER)?.grade, null);
});

test("gradeText: the SwapUp grade label, printed exactly as the server wrote it", () => {
  for (const label of ["Superb (A)", "Good (B)", "Fair (C)", "Best Value (D)", "Good (B) · provisional", "Needs repair", "Not fully tested", "Can't grade", "Not tested"]) {
    assert.equal(R.gradeText({ status: label.startsWith("Needs") ? "needs_repair" : "graded", label, grade: null, final: false }), label);
  }
  // The app never rebuilds it: no letter added, none taken away, the server's letter stands.
  assert.equal(R.gradeText({ status: "graded", label: "Good", grade: "Good", final: true }), "Good");
  assert.equal(R.gradeText({ status: "graded", label: "Good (A)", grade: "Good", letter: "A", final: true }), "Good (A)");
  assert.equal(R.gradeText({ status: "graded", label: "  Good (B)  ", grade: "Good", final: true }), "Good (B)", "trimmed");
});

test("gradeText: junk is null, never a throw", () => {
  for (const bad of [null, "Good", 3, [], {}, { status: "graded" }, { label: "Good (B)" }, { status: "excellent", label: "Excellent" }, { status: "graded", label: "  " }, { status: "graded", label: 4 }]) {
    assert.equal(R.gradeText(bad), null, JSON.stringify(bad));
  }
});

test("the customer's screen gets no money: only the link and the grade are read", () => {
  const r = R.customerReport(applied({ tradeValue: 18800, payable: 130000, price: 24999 }), SERVER);
  assert.deepEqual(Object.keys(r ?? {}).sort(), ["grade", "url"]);
  assert.doesNotMatch(JSON.stringify(r), /₹|18800|130000|24999/);
});

test("the result screen's next read (§F4): colours, waiting, an open answer, a final one, an older server", () => {
  assert.equal(R.donePollMs({ status: "testing", colours: true }), 1_500);
  assert.equal(R.donePollMs({ status: "complete" }), 4_000);
  assert.equal(R.donePollMs(null), 4_000, "a failed read tries again");
  // The advisor may still change the new phone or the storage: every 5 s.
  assert.equal(R.donePollMs({ ...applied(), answer: F.F1 }), R.ANSWER_POLL_MS);
  assert.equal(R.donePollMs({ ...applied(), answer: F.F2 }), R.ANSWER_POLL_MS, "not priced yet: soon will be");
  assert.equal(R.ANSWER_POLL_MS, 5_000);
  // Frozen at lock (or closed): stop.
  for (const a of [F.F3, F.F9, F.WALKED_AWAY, F.CANCELLED]) assert.equal(R.donePollMs({ ...applied(), answer: a }), null);
  // An older server (no answer key), none sent, or junk: slowly, so the grade follows a newer report version.
  assert.equal(R.donePollMs(applied()), R.APPLIED_POLL_MS);
  assert.equal(R.donePollMs(F.F7_STATUS), R.APPLIED_POLL_MS);
  assert.equal(R.donePollMs({ ...applied(), answer: null }), R.APPLIED_POLL_MS);
  assert.equal(R.donePollMs({ ...applied(), answer: { ready: true, lines: [] } }), R.APPLIED_POLL_MS);
  assert.equal(R.APPLIED_POLL_MS, 15_000);
});

/** A check at its result screen: the saved state the facts read. */
function done(over: Record<string, unknown> = {}) {
  return {
    v: 1,
    server: SERVER,
    code: "K7M2QX",
    ticket: "tkt",
    session: {
      id: "ts_1",
      caseRef: "SU-AND-00023",
      storeName: "Andheri West Experience Center",
      server: SERVER,
      plan: [
        { id: "speaker", name: "Speaker", critical: false },
        { id: "vibration", name: "Vibration", critical: false },
        { id: "nfc", name: "NFC", critical: false },
        { id: "touch", name: "Touch", critical: true },
        { id: "display", name: "Display", critical: true },
        { id: "battery_health", name: "Battery health", critical: false },
      ],
    },
    joinedAt: "2026-10-18T10:00:00.000Z",
    consentAt: "2026-10-18T10:00:01.000Z",
    declared: null,
    declaredSentAt: null,
    declaredAt: null,
    results: {
      speaker: { outcome: "pass", detail: null, at: "2026-10-18T10:02:00.000Z" },
      vibration: { outcome: "skip", detail: null, at: "2026-10-18T10:02:01.000Z" },
      nfc: { outcome: "unsupported", detail: null, at: "2026-10-18T10:02:02.000Z" },
      touch: { outcome: "fail", detail: null, at: "2026-10-18T10:02:03.000Z" },
    },
    acked: {},
    completeAt: "2026-10-18T10:03:00.000Z",
    completeSentAt: "2026-10-18T10:03:00.000Z",
    ended: null,
    pairing: { outcome: "handoff", at: "2026-10-18T10:01:00.000Z", reason: null },
    battery: { outcome: "read", healthPct: 91, at: "2026-10-18T10:01:30.000Z" },
    ...over,
  } as import("./core").CheckState;
}
const SERVER_DECIDES = ["display", "battery_health"];

test("resultFacts: one list for the app and the browser — 'Not tested', and only the can't-run row says which", () => {
  const native = R.resultFacts(done(), { web: false, serverDecides: SERVER_DECIDES, grade: "Fair (C)", answer: undefined });
  const web = R.resultFacts(done(), { web: true, serverDecides: SERVER_DECIDES, grade: "Fair (C)", answer: undefined });
  assert.deepEqual(native, [
    { label: "Trade-in", value: "SU-AND-00023" },
    { label: "Passed", value: "1", tone: "pass" },
    { label: "Failed", value: "1", tone: "fail" },
    { label: "Not tested", value: "1", tone: "warn" },
    { label: "Not on this phone", value: "1", tone: "muted" },
    { label: "Screen and glass", value: "Store camera", tone: "muted" },
    { label: "Battery health", value: "91 %", tone: "muted" },
    { label: "SwapUp grade", value: "Fair (C)" },
  ]);
  assert.deepEqual(web.map((r) => r.label), native.map((r) => (r.label === "Not on this phone" ? "Not in this browser" : r.label)));
  assert.deepEqual(web.map((r) => r.value), native.map((r) => r.value));
  assert.ok(!web.some((r) => r.label === "Skipped"));
});

test("resultFacts: the grade row only from an older server — with an answer, the grade is the answer's line", () => {
  for (const answer of [A.readAnswer(F.F1), A.readAnswer(F.F2), null]) {
    const rows = R.resultFacts(done(), { web: false, serverDecides: SERVER_DECIDES, grade: "Fair (C)", answer });
    assert.ok(!rows.some((r) => r.label === "SwapUp grade"), JSON.stringify(answer));
  }
  assert.ok(!R.resultFacts(done(), { web: false, serverDecides: SERVER_DECIDES, grade: null, answer: undefined }).some((r) => r.label === "SwapUp grade"));
});

test("resultFacts: the advisor checks what the camera didn't; rows only for what the plan has", () => {
  const advisor = R.resultFacts(done({ pairing: { outcome: "skipped", at: "2026-10-18T10:01:00.000Z", reason: "advisor" }, battery: null }), { web: true, serverDecides: SERVER_DECIDES });
  assert.equal(advisor.find((r) => r.label === "Screen and glass")?.value, "Advisor");
  assert.equal(advisor.find((r) => r.label === "Battery health")?.value, "not checked");
  const bare = R.resultFacts(done({ results: {} }), { web: false, serverDecides: [] });
  assert.deepEqual(bare.map((r) => r.label), ["Trade-in", "Passed", "Failed", "Not tested"]);
});

test("resultHead: the four states of the result screen (§F2)", () => {
  assert.deepEqual(R.resultHead(false, undefined), { headline: "Checks complete", lead: "The advisor confirms your price.", show: "checklist" });
  assert.deepEqual(R.resultHead(true, undefined), { headline: "The store has your results", lead: "Nothing more to do here.", show: "tick" });
  assert.deepEqual(R.resultHead(true, null), { headline: "The store has your results", lead: "Nothing more to do here.", show: "tick" });
  assert.deepEqual(R.resultHead(true, A.readAnswer(F.F2)), { headline: "The store has your results", lead: "The advisor is working out your price.", show: "tick" });
  assert.deepEqual(R.resultHead(true, A.readAnswer(F.F1)), { headline: "An upgrade is worth considering", lead: null, show: "answer" });
  assert.deepEqual(R.resultHead(true, A.readAnswer(F.F3)), { headline: "Traded in", lead: null, show: "answer" });
  // Before Apply nothing is priced on the phone, whatever a status carries.
  assert.equal(R.resultHead(false, A.readAnswer(F.F1)).show, "checklist");
});

test("clearDataGuide: the clear-your-phone card only once traded in (R6); as before without an answer", () => {
  assert.equal(R.clearDataGuide(false, undefined), "wait");
  assert.equal(R.clearDataGuide(true, undefined), "card", "an older server: as before");
  assert.equal(R.clearDataGuide(true, null), "card");
  assert.equal(R.clearDataGuide(true, A.readAnswer(F.F3)), "card", "traded in");
  assert.equal(R.clearDataGuide(true, A.readAnswer(F.F1)), "wait", "still at the counter: don't reset it yet");
  assert.equal(R.clearDataGuide(true, A.readAnswer(F.F2)), "wait");
  for (const a of [F.F9, F.WALKED_AWAY, F.CANCELLED]) assert.equal(R.clearDataGuide(true, A.readAnswer(a)), null, "they keep the phone");
});
