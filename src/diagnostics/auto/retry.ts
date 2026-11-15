// Pure retry rules for diagnostic tests: any test that does not complete is
// tried up to 3 times; if it still cannot complete after 3 attempts, it is
// marked as not working / issue with component detection.
// No React Native imports so node --test can test this module directly.
import type { Detail, Outcome, Verdict } from "./analysis";

export const MAX_TEST_ATTEMPTS = 3;

export const COMPONENT_DETECTION_ISSUE = "Not working or issue with component detection";

export function formatFailureVerdict(lastVerdict: Verdict, attempts = MAX_TEST_ATTEMPTS): Verdict {
  const prevReason = typeof lastVerdict.detail?.reason === "string" ? lastVerdict.detail.reason : null;
  return {
    outcome: "fail",
    detail: {
      ...(lastVerdict.detail ?? {}),
      attempts,
      componentStatus: COMPONENT_DETECTION_ISSUE,
      reason: prevReason
        ? `${COMPONENT_DETECTION_ISSUE} (after ${attempts} attempts): ${prevReason}`
        : `${COMPONENT_DETECTION_ISSUE} (after ${attempts} attempts)`,
    },
  };
}

/**
 * Run an automatic diagnostic step up to MAX_TEST_ATTEMPTS (3) times if it does
 * not complete with "pass" (or "unsupported"). After 3 unsuccessful attempts,
 * returns a "fail" verdict stating the component is not working or has a
 * component detection issue.
 */
export async function runWithThreeTries(
  runStep: (attempt: number) => Promise<Verdict>,
  onRetry?: (nextAttempt: number, lastVerdict: Verdict) => Promise<void> | void
): Promise<Verdict> {
  let lastVerdict: Verdict = {
    outcome: "skip",
    detail: { method: "retry", reason: "test did not complete" },
  };

  for (let attempt = 1; attempt <= MAX_TEST_ATTEMPTS; attempt++) {
    try {
      lastVerdict = await runStep(attempt);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 160);
      lastVerdict = {
        outcome: "skip",
        detail: { method: "error", reason: `the check stopped unexpectedly: ${msg}` },
      };
    }

    if (lastVerdict.outcome === "pass" || lastVerdict.outcome === "unsupported") {
      return {
        outcome: lastVerdict.outcome,
        detail: {
          ...(lastVerdict.detail ?? {}),
          attempts: attempt,
        },
      };
    }

    if (attempt < MAX_TEST_ATTEMPTS) {
      await onRetry?.(attempt + 1, lastVerdict);
    }
  }

  return formatFailureVerdict(lastVerdict, MAX_TEST_ATTEMPTS);
}

/**
 * Resolve an attempt for an interactive/guided test (browser RunnerScreen or
 * native Actions): retries up to 3 times before reporting "fail" with
 * COMPONENT_DETECTION_ISSUE.
 */
export function resolveInteractiveAttempt(
  outcome: Outcome,
  attempt: number,
  detail?: Record<string, string | number | boolean | null> | null
): {
  done: boolean;
  nextAttempt: number;
  finalOutcome: Outcome;
  finalDetail: Record<string, string | number | boolean | null>;
  message: string | null;
} {
  const baseDetail = { ...(detail ?? {}) };

  if (outcome === "pass" || outcome === "unsupported") {
    return {
      done: true,
      nextAttempt: attempt,
      finalOutcome: outcome,
      finalDetail: { ...baseDetail, attempts: attempt },
      message: null,
    };
  }

  if (attempt < MAX_TEST_ATTEMPTS) {
    const nextAttempt = attempt + 1;
    return {
      done: false,
      nextAttempt,
      finalOutcome: outcome,
      finalDetail: { ...baseDetail, attempts: attempt },
      message: `Test did not complete (attempt ${attempt} of ${MAX_TEST_ATTEMPTS}) — retrying (${nextAttempt} of ${MAX_TEST_ATTEMPTS})…`,
    };
  }

  const prevReason = typeof baseDetail.reason === "string" ? baseDetail.reason : null;
  return {
    done: true,
    nextAttempt: attempt,
    finalOutcome: "fail",
    finalDetail: {
      ...baseDetail,
      attempts: MAX_TEST_ATTEMPTS,
      componentStatus: COMPONENT_DETECTION_ISSUE,
      reason: prevReason
        ? `${COMPONENT_DETECTION_ISSUE} (after ${MAX_TEST_ATTEMPTS} attempts): ${prevReason}`
        : `${COMPONENT_DETECTION_ISSUE} (after ${MAX_TEST_ATTEMPTS} attempts)`,
    },
    message: `${COMPONENT_DETECTION_ISSUE} (tried ${MAX_TEST_ATTEMPTS} times).`,
  };
}
