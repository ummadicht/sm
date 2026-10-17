// node --test --experimental-strip-types --no-warnings src/store/pin.test.ts
// Loaded with an explicit ".ts" at runtime (Node needs it) while tsc type-checks
// the extensionless path — same trick as src/diagnostics/auto/analysis.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const P: typeof import("./pin") = await import("./pin" + ".ts");

const RUN = "Pick a PIN that isn't a run or one repeated digit.";
const SHAPE = "The PIN is 4 digits.";

test("pinProblem: four digits, nothing else", () => {
  for (const bad of ["", "123", "12345", "12a4", " 1357", "1357 ", "١٢٣٤", null, undefined, 1357, ["1", "3", "5", "7"]]) {
    assert.equal(P.pinProblem(bad), SHAPE, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("pinProblem: one repeated digit is refused", () => {
  for (let d = 0; d <= 9; d++) assert.equal(P.pinProblem(String(d).repeat(4)), RUN);
});

test("pinProblem: straight runs up and down are refused, wrapping ones are not needed", () => {
  for (const run of ["0123", "1234", "2345", "3456", "4567", "5678", "6789"]) assert.equal(P.pinProblem(run), RUN, run);
  for (const run of ["9876", "8765", "7654", "6543", "5432", "4321", "3210"]) assert.equal(P.pinProblem(run), RUN, run);
  // Not a straight run → fine (wrapping isn't checked; steps of 2 aren't runs).
  for (const ok of ["7890", "8901", "0987", "1357", "2468", "1235", "1123", "1212", "0001", "4826", "1004"]) {
    assert.equal(P.pinProblem(ok), null, ok);
  }
});

test("newPinProblem: a good PIN typed twice", () => {
  assert.equal(P.newPinProblem("4826", "4826"), null);
  assert.equal(P.newPinProblem("4826", "4862"), "The two PINs don't match. Type the same PIN twice.");
  // The PIN's own problem comes first — no point matching a PIN that can't be used.
  assert.equal(P.newPinProblem("1234", "1234"), RUN);
  assert.equal(P.newPinProblem("12", "12"), SHAPE);
});

test("pinInput: digits only, at most four", () => {
  assert.equal(P.pinInput("12 34"), "1234");
  assert.equal(P.pinInput("98765"), "9876");
  assert.equal(P.pinInput("a1-b2"), "12");
  assert.equal(P.pinInput(""), "");
});

test("idle lock: only Home, New trade-in and Settings lock; a session or the web desk never does", () => {
  assert.equal(P.TABLET_IDLE_MS, 15 * 60_000);
  for (const s of ["home", "new", "settings"]) assert.equal(P.idleLocks(s), true, s);
  for (const s of ["session", "web"]) assert.equal(P.idleLocks(s), false, s);
  const t0 = 1_000_000;
  assert.equal(P.isIdle(t0, t0 + P.TABLET_IDLE_MS - 1), false);
  assert.equal(P.isIdle(t0, t0 + P.TABLET_IDLE_MS), true);
  assert.equal(P.isIdle(t0, t0 + 5_000, 5_000), true);
});

test("firstName: for the Switch button", () => {
  assert.equal(P.firstName("Asha Rao"), "Asha");
  assert.equal(P.firstName("  Ravi   Kumar  "), "Ravi");
  assert.equal(P.firstName("Meena"), "Meena");
  assert.equal(P.firstName(""), "");
});

test("deviceNameProblem: 2 to 40 characters after trimming", () => {
  const S = "Give the tablet a name of 2 to 40 characters, like “Counter tablet 1”.";
  assert.equal(P.deviceNameProblem("Counter tablet"), null);
  assert.equal(P.deviceNameProblem("  T1  "), null);
  assert.equal(P.deviceNameProblem("x".repeat(40)), null);
  for (const bad of ["", " ", " a ", "x".repeat(41), null, 12]) assert.equal(P.deviceNameProblem(bad), S, JSON.stringify(bad));
});
