// How the NATIVE customer app splits the server's test plan (docs/AUTO-TESTS.md):
//   auto      — run by themselves, one progress bar, no questions
//   actions   — the only two things the customer does: swipe the grid, plug in the charger
//   notInRun  — recorded as skip "not in the automatic run" (multitouch, buttons)
//   server    — not posted by the phone (display: GradeIQ's camera LCD sweep decides)
//   unknown   — ids this app version doesn't know → "unsupported", never silently missing
// No runtime imports — node --test runs it.

/** The order the automatic steps run in. Flash comes before the cameras: the
 * phone is still lying screen-up, so the rear lens faces the counter — a dark
 * scene the torch visibly lights. The cameras then ask for the phone to be held up. */
export const AUTO_ORDER = ["battery", "sensors", "motion", "connectivity", "vibration", "speaker", "mic", "voice", "flash", "camera", "faceid", "bluetooth", "nfc"] as const;
export const ACTION_ORDER = ["touch", "charging"] as const;
export const NOT_IN_AUTO_RUN = ["multitouch", "buttons"] as const;
export const SERVER_DECIDES = ["display"] as const;

export const NOT_IN_RUN_REASON = "not in the automatic run";

export type NativePlan = {
  auto: string[];
  actions: string[];
  notInRun: string[];
  server: string[];
  unknown: string[];
};

const has = (list: readonly string[], id: string) => list.includes(id);

/** Partition the plan's ids; `auto` and `actions` follow this app's order, not the plan's. */
export function partitionPlan(planIds: string[]): NativePlan {
  const ids = Array.from(new Set(planIds));
  return {
    auto: AUTO_ORDER.filter((id) => ids.includes(id)),
    actions: ACTION_ORDER.filter((id) => ids.includes(id)),
    notInRun: ids.filter((id) => has(NOT_IN_AUTO_RUN, id)),
    server: ids.filter((id) => has(SERVER_DECIDES, id)),
    unknown: ids.filter((id) => !has(AUTO_ORDER, id) && !has(ACTION_ORDER, id) && !has(NOT_IN_AUTO_RUN, id) && !has(SERVER_DECIDES, id)),
  };
}

export type NativeStep = "pairing" | "auto" | "actions" | "done";

/** Where a (resumed) native check is. `display` is never waited for — the server decides it. */
export function nativeStep(pairingDone: boolean, results: Record<string, unknown>, plan: NativePlan): NativeStep {
  if (!pairingDone) return "pairing";
  const missing = (ids: string[]) => ids.some((id) => !results[id]);
  if (missing(plan.auto) || missing(plan.notInRun) || missing(plan.unknown)) return "auto";
  if (missing(plan.actions)) return "actions";
  return "done";
}

/**
 * The runner's units of work. speaker + mic are ONE loopback run (the speaker
 * is heard through the mic); every other step posts a single test id.
 */
export type AutoStepId = "battery" | "sensors" | "motion" | "connectivity" | "vibration" | "loopback" | "voice" | "flash" | "camera" | "faceid" | "bluetooth" | "nfc";

export function autoSteps(ids: string[]): AutoStepId[] {
  const out: AutoStepId[] = [];
  for (const id of AUTO_ORDER) {
    if (!ids.includes(id)) continue;
    const step: AutoStepId = id === "speaker" || id === "mic" ? "loopback" : (id as AutoStepId);
    if (!out.includes(step)) out.push(step);
  }
  return out;
}

/** Which automatic tests a "Test again" from the Done screen should repeat: the failed and skipped ones we can run. */
export function rerunnable(plan: NativePlan, results: Record<string, { outcome: string } | undefined>): string[] {
  return [...plan.auto, ...plan.actions].filter((id) => {
    const o = results[id]?.outcome;
    return o === "fail" || o === "skip";
  });
}
