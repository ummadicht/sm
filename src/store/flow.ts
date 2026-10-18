// THE STORE FLOW, REDUCED (owner, 2026-10-17: "Reduce the flow" — the fewest steps that keep
// the law, the money and safety):
//
//   1 New trade-in (the customer's mobile) → 2 the customer's phone connects (code / QR) →
//   3 ONE camera pass (photos + the colour sweep together; "Check the phone" inside it only
//     when the camera can't decide) → 4 THE ANSWER, by itself → 5 Swap up: one "Take the
//     trade-in" screen. Repair / Walked away end the visit from the answer.
//
// The server puts the results on the case once the phone's tests and the camera grade are in
// (TestSessionView.autoApply — swapup lib/domain/autoApply.ts, the same gates as Apply). This
// app never taps Apply on the way: it offers Apply only as a Retry when the server says Apply
// refused, for a phone that stopped mid-test ("Apply partial results"), and to an older
// server that sends no `autoApply`.
//
// No runtime imports — node --test runs it (./flow.test.ts).
import type { Tone } from "./ui";
import type { Layout, PhonePhase, ScanStage } from "./phoneLed";
import type { CertifyView } from "./certify";

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);

// ── the answer by itself ─────────────────────────────────────────────────────

export type AutoApplyWait = "tests" | "camera" | "certify";

export type AutoApply =
  | { state: "off" }
  | { state: "waiting"; for: AutoApplyWait; text: string }
  /** Everything is in: the server is putting the results on the case. */
  | { state: "ready" }
  /** Apply refused, in its own words. Retry = a manual Apply. */
  | { state: "refused"; reason: string }
  | { state: "applied" };

/** session.autoApply → what it says. null = the server sent none (an older one): the app shows "Get the answer" (a manual Apply). */
export function readAutoApply(raw: unknown): AutoApply | null {
  const a = obj(obj(raw)?.autoApply);
  if (!a) return null;
  switch (a.state) {
    case "off":
    case "ready":
    case "applied":
      return { state: a.state };
    case "waiting": {
      const f = a.for === "camera" || a.for === "certify" ? a.for : "tests";
      return { state: "waiting", for: f, text: str(a.text) ?? "" };
    }
    case "refused":
      return { state: "refused", reason: str(a.reason) ?? "Apply didn't go through." };
    default:
      return null;
  }
}

// ── "Check the phone" inside the camera step ─────────────────────────────────

/** The camera couldn't decide the screen or the body: there is a card. A lone liquid row (an older server) is not one. */
export function cameraUndecided(v: CertifyView | null): boolean {
  return !!v && (v.needed.includes("screen") || v.needed.includes("body"));
}

/**
 * The camera has been — or never will be: the photos and sweep are behind the phone (phone-led:
 * scanned, gone on without it, camera off), or an older phone has finished (its photos come last).
 */
export function cameraOver(i: { layout: Layout; stage: ScanStage; status: string; cameraOff: boolean; photosDone: boolean; screenDone: boolean }): boolean {
  if (i.status === "complete" || i.status === "applied" || i.cameraOff) return true;
  if (i.layout === "scanFirst") return i.stage === "done" || i.stage === "skipped" || i.stage === "off";
  return i.photosDone && i.screenDone;
}

/**
 * The card goes inside step 3 once the camera is over, couldn't decide, and its grade isn't
 * still coming (it may yet decide). The Screen row then waits for the customer's phone to show
 * the colours (after its tests); the other rows can be tapped at once.
 */
export function certifyInCamera(v: CertifyView | null, i: { cameraOver: boolean; gradePending: boolean }): boolean {
  return cameraUndecided(v) && i.cameraOver && !i.gradePending;
}

/** On the answer: the card only when a row is still open — the results went on before the taps (a manual Apply). */
export function certifyStillOpen(v: CertifyView | null): boolean {
  return cameraUndecided(v) && v!.needed.some((r) => !v!.rows[r]) && v!.canEdit;
}

/**
 * "Check the phone" on the answer: "open" while a row is still untapped; "change" once every row
 * is tapped and the case is still at the counter — shown closed ("Checked by Asha · change"), so
 * a wrong last tap (the answer opened by itself half a second later) is one tap to put right;
 * null when there is nothing to check or change.
 */
export function answerCertifyMode(v: CertifyView | null): "open" | "change" | null {
  if (!v || !cameraUndecided(v) || !v.canEdit) return null;
  if (v.needed.some((r) => !v.rows[r])) return "open";
  return Object.values(v.rows).some(Boolean) ? "change" : null;
}

/** "Checked by Asha · change" — the closed card's one line (every name that tapped, once). */
export function checkedByLine(v: CertifyView): string {
  const names = [...new Set(Object.values(v.rows).map((r) => r?.by).filter((x): x is string => !!x))];
  return `Checked by ${names.length ? names.join(" and ") : "staff"} · change`;
}

/**
 * The Screen row waits while the customer's phone is still testing and will show the test colours
 * after: a tap now would be a look at the test screens, not the colours (the server refuses it too).
 */
export function holdScreen(v: CertifyView | null, sessionStatus: string): boolean {
  return !!v && v.colours === "waiting" && !["complete", "applied"].includes(sessionStatus);
}

// ── which step is the advisor's ──────────────────────────────────────────────

export type SessionStep = "connect" | "camera" | "answer";

/**
 * The step card the advisor is needed at now (outlined), or null while the customer's phone is
 * working by itself (identifying, testing). `cameraNow`: the camera step needs the advisor (the
 * phone shows its scan code, the photo screen is up, the card is open).
 */
export function activeStep(i: { status: string; cameraNow: boolean; autoApply: AutoApply | null }): SessionStep | null {
  switch (i.status) {
    case "waiting":
    case "opened":
      return "connect";
    case "joined":
    case "testing":
      return i.cameraNow ? "camera" : null;
    case "complete": {
      const a = i.autoApply;
      if (a?.state === "waiting" && (a.for === "certify" || a.for === "camera")) return "camera";
      return "answer";
    }
    default:
      return "answer";
  }
}

// ── the line at the top ──────────────────────────────────────────────────────

type Line = { text: string; tone: Tone };

/**
 * The one sentence at the top of the Session screen: what is happening, and what the advisor
 * does next. `phoneLine` is ./phoneLed.ts scanFirstNow() for a phone-led session that is joined
 * or testing (null otherwise).
 */
export function sessionNow(i: {
  status: string;
  caseRef: string;
  progress: { done: number; total: number } | null;
  joinedAt: string | null;
  layout: Layout;
  phase: PhonePhase | null;
  autoApply: AutoApply | null;
  certify: CertifyView | null;
  certifyShown: boolean;
  phoneLine: Line | null;
}): Line {
  const done = i.progress?.done ?? 0;
  const total = i.progress?.total ?? 0;
  const tested = total ? ` — ${done} of ${total} done` : "";
  switch (i.status) {
    case "waiting":
      return { text: "Customer scans the test code (step 2).", tone: "muted" };
    case "opened":
      return { text: "Page opened — next, open SwapUp Check.", tone: "fix" };
    case "joined":
    case "testing": {
      // The camera couldn't decide and the phone is still testing: the body and liquid rows can go now.
      if (i.certifyShown) return { text: `Testing${tested}; check the phone meanwhile (step 3).`, tone: "fix" };
      if (i.phoneLine) return i.phoneLine;
      return i.status === "joined"
        ? { text: "Phone connected — photos after its tests (step 3).", tone: "fix" }
        : { text: `Testing${tested}.`, tone: "fix" };
    }
    case "complete": {
      const a = i.autoApply;
      if (!a) return { text: "Tests done — put the results on the case (step 4).", tone: "up" };
      if (a.state === "waiting" && a.for === "certify")
        return i.certify?.colours === "showing" || i.phase === "colours"
          ? { text: "Phone shows the test colours — tap what you see (step 3).", tone: "fix" }
          : { text: "Tests done — check the phone (step 3).", tone: "fix" };
      if (a.state === "waiting") return { text: a.text || "Camera grade coming — the answer opens itself.", tone: "fix" };
      // The reason itself is said once, in step 4 beside Retry.
      if (a.state === "refused") return { text: "Not on the case — see step 4.", tone: "bad" };
      return { text: "Putting the results on the case…", tone: "up" };
    }
    case "applied":
      return { text: `On case ${i.caseRef} — opening the answer…`, tone: "up" };
    case "expired":
      return { text: i.joinedAt ? "Test expired (2 h after connecting)." : "Code expired before the phone connected.", tone: "warn" };
    case "cancelled":
      return { text: "Test cancelled — the code no longer works.", tone: "muted" };
    default:
      return { text: String(i.status), tone: "muted" };
  }
}

/** Step 4's own sentence, under its title. */
export function answerStepText(status: string, autoApply: AutoApply | null): string {
  switch (status) {
    case "complete":
      if (!autoApply) return "Put the results on the case to price it.";
      if (autoApply.state === "refused") return autoApply.reason;
      if (autoApply.state === "waiting" && autoApply.for === "certify") return "Opens after your last tap on “Check the phone”.";
      if (autoApply.state === "waiting") return "Opens when the camera grade is in.";
      return "Putting the results on the case…";
    case "applied":
      return "The results are on the case.";
    case "expired":
      return "A new code keeps the same case.";
    case "cancelled":
      return "Test cancelled — start again from Home.";
    default:
      return "Opens by itself after the tests and the camera.";
  }
}
