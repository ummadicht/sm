// How the NATIVE customer app splits the server's test plan (docs/AUTO-TESTS.md):
//   auto      — run by themselves, one progress bar, no questions
//   actions   — the only two things the customer does: swipe the grid, plug in the charger
//   notInRun  — recorded as skip "not in the automatic run" (multitouch, buttons)
//   server    — not posted by the phone (display: GradeIQ's camera LCD sweep decides, or the
//               advisor certifies it in SwapUp Store; battery_health: the server records
//               what GradeIQ read off the screenshot). The browser check leaves them out too.
//   unknown   — ids this app version doesn't know → "unsupported", never silently missing
// No runtime imports — node --test runs it.

/** The order the automatic steps run in. Flash comes before the cameras: the
 * runner tells the customer to leave the phone on the counter, so the rear lens
 * faces the counter — a dark scene the torch visibly lights. The cameras then
 * ask for the phone to be held up. */
export const AUTO_ORDER = ["battery", "sensors", "motion", "connectivity", "vibration", "speaker", "mic", "voice", "flash", "camera", "faceid", "bluetooth", "nfc"] as const;
export const ACTION_ORDER = ["touch", "charging"] as const;
export const NOT_IN_AUTO_RUN = ["multitouch", "buttons"] as const;
export const SERVER_DECIDES = ["display", "battery_health"] as const;

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

export type NativeStep = "identify" | "scan" | "battery" | "auto" | "actions" | "done";

/** What the phone has already finished before its own tests (each is kept on disk, so a restart resumes). */
export type NativeProgress = {
  /** The Identify step is done (or the check began before it existed). */
  identified: boolean;
  /** The Scan screen has ended: the camera finished, the advisor went on without it, or it was unavailable. */
  scanned: boolean;
  /** The battery screenshot step has ended — or this check has none. */
  battery: boolean;
};

/**
 * Where a (resumed) native check is — GradeIQ v2's order, the phone leading
 * (swapup docs/PHONE-LED-FLOW.md): Identify (an unrecognised phone only) → Scan
 * (the store's camera, vision first) → battery screenshot → the automatic tests →
 * the two actions → done. The customer waits on the Scan screen for the advisor,
 * who scans it or taps "Continue without camera" — the customer is not asked
 * (./pairing; an older server still gets the 90 s skip). `display` and
 * `battery_health` are never waited for — the server decides them.
 */
export function nativeStep(p: NativeProgress, results: Record<string, unknown>, plan: NativePlan): NativeStep {
  if (!p.identified) return "identify";
  if (!p.scanned) return "scan";
  if (!p.battery) return "battery";
  const missing = (ids: string[]) => ids.some((id) => !results[id]);
  if (missing(plan.auto) || missing(plan.notInRun) || missing(plan.unknown)) return "auto";
  if (missing(plan.actions)) return "actions";
  return "done";
}

/** The phone has reached its own tests (or finished them): Identify, Scan and the battery step are behind it. */
export function testsStarted(step: NativeStep): boolean {
  return step === "auto" || step === "actions" || step === "done";
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
