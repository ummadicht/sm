// node --test --experimental-strip-types --no-warnings src/check/report.test.ts
// The customer's link to the grade report on the Check app's result screen (grading spec §5),
// and the SwapUp grade beside it, as the server wrote it. Same import trick as ./identify.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const R: typeof import("./report") = await import("./report" + ".ts");

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

test("the Done screen keeps reading after Apply — slowly — so its grade follows the newest report version", () => {
  assert.equal(R.donePollMs({ status: "testing", colours: true }), 1_500);
  assert.equal(R.donePollMs({ status: "complete" }), 4_000);
  assert.equal(R.donePollMs(null), 4_000, "a failed read tries again");
  assert.equal(R.donePollMs({ status: "applied" }), R.APPLIED_POLL_MS);
  assert.equal(R.APPLIED_POLL_MS, 15_000);
});
