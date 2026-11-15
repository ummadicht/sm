// node --test --experimental-strip-types --no-warnings src/diagnostics/auto/retry.test.ts
import test from "node:test";
import assert from "node:assert/strict";

const R: typeof import("./retry") = await import("./retry" + ".ts");

test("runWithThreeTries returns immediately when a test passes on the first try", async () => {
  let calls = 0;
  const res = await R.runWithThreeTries(async (attempt) => {
    calls = attempt;
    return { outcome: "pass", detail: { method: "sensor" } };
  });
  assert.equal(calls, 1);
  assert.equal(res.outcome, "pass");
  assert.equal(res.detail.attempts, 1);
});

test("runWithThreeTries retries up to 3 times and passes if attempt 2 or 3 succeeds", async () => {
  const seen: number[] = [];
  const res = await R.runWithThreeTries(async (attempt): Promise<import("./analysis").Verdict> => {
    seen.push(attempt);
    if (attempt < 3) return { outcome: "skip", detail: { method: "timeout", reason: "timed out" } };
    return { outcome: "pass", detail: { method: "sensor" } };
  });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(res.outcome, "pass");
  assert.equal(res.detail.attempts, 3);
});

test("runWithThreeTries marks test as fail with component detection issue after 3 non-completing attempts", async () => {
  let retries = 0;
  const res = await R.runWithThreeTries(
    async () => ({ outcome: "skip", detail: { method: "timeout", reason: "sensor did not respond" } }),
    () => {
      retries++;
    }
  );
  assert.equal(retries, 2);
  assert.equal(res.outcome, "fail");
  assert.equal(res.detail.attempts, 3);
  assert.equal(res.detail.componentStatus, R.COMPONENT_DETECTION_ISSUE);
  assert.match(String(res.detail.reason), /Not working or issue with component detection \(after 3 attempts\)/);
});

test("resolveInteractiveAttempt retries attempts 1 and 2, and reports component detection issue on attempt 3", () => {
  const a1 = R.resolveInteractiveAttempt("skip", 1, { reason: "timeout" });
  assert.equal(a1.done, false);
  assert.equal(a1.nextAttempt, 2);
  assert.match(String(a1.message), /attempt 1 of 3/);

  const a2 = R.resolveInteractiveAttempt("fail", 2, { reason: "no signal" });
  assert.equal(a2.done, false);
  assert.equal(a2.nextAttempt, 3);
  assert.match(String(a2.message), /attempt 2 of 3/);

  const a3 = R.resolveInteractiveAttempt("skip", 3, { reason: "no signal" });
  assert.equal(a3.done, true);
  assert.equal(a3.finalOutcome, "fail");
  assert.equal(a3.finalDetail.attempts, 3);
  assert.equal(a3.finalDetail.componentStatus, R.COMPONENT_DETECTION_ISSUE);
  assert.match(String(a3.message), /Not working or issue with component detection/);
});
