// Verbatim port of GradeIQ web lib/grading.ts (gradeFunctional).
import { FUNCTIONAL_TESTS, Results } from "./catalog";

export type FunctionalVerdict = {
  grade: "Working" | "Faulty" | "";
  passed: number;
  failed: number;
  skipped: number;
  /** Tests actually attempted (passed + failed) — the denominator for "8/8". */
  total: number;
  catalogTotal: number;
  notRun: number;
  criticalFailures: string[];
  failures: string[];
};

export function gradeFunctional(results: Results): FunctionalVerdict {
  let passed = 0, failed = 0, skipped = 0;
  const criticalFailures: string[] = [];
  const failures: string[] = [];
  for (const t of FUNCTIONAL_TESTS) {
    const r = results[t.id];
    if (r === "pass") passed++;
    else if (r === "fail") {
      failed++;
      failures.push(t.name);
      if (t.critical) criticalFailures.push(t.name);
    } else skipped++;
  }
  const answered = passed + failed;
  return {
    grade: answered === 0 ? "" : criticalFailures.length ? "Faulty" : "Working",
    passed, failed, skipped,
    total: answered,
    catalogTotal: FUNCTIONAL_TESTS.length,
    notRun: FUNCTIONAL_TESTS.length - answered,
    criticalFailures,
    failures,
  };
}

/** IMEI check digit (Luhn) — identical rule to GradeIQ lib/luhn.ts. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{15}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
