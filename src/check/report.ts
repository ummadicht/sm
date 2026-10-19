// The customer's result screen, after the tests (./ResultScreen.tsx — ONE screen for the native app
// and the browser). Once the store has applied the results, GET /api/device/status carries
// `reportPath` — the public report page, "/r/<token>", which shows what was tested and why the phone
// got its grade, never a price — and, from a server that sends them, the SwapUp grade label
// ("Good (B)") and THE ANSWER (`answer`, read by ../shared/answer.ts readAnswer): the grade, the
// market price, what we pay, the bonus and the repair, every word the server's (owner, 2026-10-18:
// the answer goes on the customer's phone too). This file reads the status and words the rest of
// the screen: its facts, its heading, how often it asks again.
// No React Native imports: ./report.test.ts runs under plain node (it adds the ".ts" Metro leaves off).
import { BATTERY_HEALTH_ID, countResults, type CheckState } from "./core";
import { batteryResultText } from "./battery";
import { readAnswer, type AnswerView } from "../shared/answer";

const STATUSES = ["not_tested", "cannot_grade", "needs_repair", "incomplete", "graded"] as const;

/** What the result screen shows: the report's address and, when the store sent it, the grade line. */
export type CustomerReport = { url: string; grade: string | null };

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);

/**
 * The report's address on the store's server. A relative path ("/r/<token>") goes on the server
 * this phone already talks to; the server's own absolute http(s) address is kept as it is.
 * Anything else — another scheme, "//host", spaces — is no link at all.
 */
export function reportUrl(server: string, path: unknown): string | null {
  const p = str(path);
  if (!p || /\s|\\/.test(p)) return null;
  if (/^https?:\/\/[^/?#]+/i.test(p)) return p;
  if (!p.startsWith("/") || p.startsWith("//")) return null;
  return server.replace(/\/+$/, "") + p;
}

/**
 * "Good (B)", "Good (B) · provisional", "Needs repair"… — the status's `grading.label` as the
 * server wrote it, or null when there is none (or the status isn't one the server sends).
 */
export function gradeText(x: unknown): string | null {
  const g = obj(x);
  const status = typeof g?.status === "string" && (STATUSES as readonly string[]).includes(g.status) ? g.status : null;
  const label = str(g?.label);
  return g && status && label ? label : null;
}

/** The status's report, only once the store has applied the results; null before, or with no usable link. */
export function customerReport(remote: unknown, server: string): CustomerReport | null {
  const r = obj(remote);
  if (!r || r.status !== "applied") return null;
  const url = reportUrl(server, r.reportPath);
  return url ? { url, grade: gradeText(r.grading) } : null;
}

/** After the store applied the results, from an older server (no answer): how often the screen asks again, so its grade follows a newer report version. */
export const APPLIED_POLL_MS = 15_000;
/** While the answer is open: the advisor may still change the new phone or the storage at the counter. */
export const ANSWER_POLL_MS = 5_000;

/**
 * The result screen's next status read, or null to stop: every 1.5 s while the advisor checks the
 * screen by eye (the colours are up), every 4 s until the store applies; then every 5 s while the
 * answer can still change, never again once it is final (the figures are frozen at lock) — and,
 * from an older server that sends no answer, every 15 s (a later report version moves the grade).
 */
export function donePollMs(r: { status?: unknown; colours?: unknown; answer?: unknown } | null): number | null {
  if (r?.status === "applied") {
    const a = readAnswer(r.answer);
    if (!a) return APPLIED_POLL_MS;
    return a.final ? null : ANSWER_POLL_MS;
  }
  return r?.colours === true ? 1_500 : 4_000;
}

/** One fact row on the result screen. */
export type Fact = { label: string; value: string; tone?: "pass" | "fail" | "warn" | "muted" };

/**
 * The result screen's facts — the same rows and words on the native app and in the browser
 * ("Not tested", never "Skipped"); only the can't-run row says which ("Not in this browser" /
 * "Not on this phone"). `serverDecides`: the plan's tests the server decides (display, battery
 * health). The SwapUp grade row only from an older server (`answer` undefined): otherwise the grade
 * is the answer's own first line — one grade on the screen.
 */
export function resultFacts(st: CheckState, o: { web: boolean; serverDecides: readonly string[]; grade?: string | null; answer?: AnswerView | null }): Fact[] {
  const c = countResults(st.session.plan, st.results);
  const photos = st.pairing?.outcome;
  const rows: Fact[] = [
    { label: "Trade-in", value: st.session.caseRef },
    { label: "Passed", value: String(c.passed), tone: "pass" },
    { label: "Failed", value: String(c.failed), tone: c.failed ? "fail" : undefined },
    { label: "Not tested", value: String(c.skipped), tone: c.skipped ? "warn" : undefined },
  ];
  if (c.unsupported) rows.push({ label: o.web ? "Not in this browser" : "Not on this phone", value: String(c.unsupported), tone: "muted" });
  // The camera photographed it; whatever it couldn't decide, the advisor checks — never the customer.
  if (o.serverDecides.includes("display")) rows.push({ label: "Screen and glass", value: photos === "handoff" || photos === "grace" ? "Store camera" : "Advisor", tone: "muted" });
  if (o.serverDecides.includes(BATTERY_HEALTH_ID)) rows.push({ label: "Battery health", value: batteryResultText(st.battery), tone: "muted" });
  if (o.answer === undefined && o.grade) rows.push({ label: "SwapUp grade", value: o.grade });
  return rows;
}

/**
 * The result screen's heading and what stands under it: before the store applies, "Checks complete"
 * and the checklist; after, the answer's own headline over the answer — or, while it isn't priced
 * yet, "The store has your results" with the server's one sentence; from an older server (no
 * answer), the same heading with "Nothing more to do here.", as before.
 */
export function resultHead(applied: boolean, answer: AnswerView | null | undefined): { headline: string; lead: string | null; show: "checklist" | "tick" | "answer" } {
  if (!applied) return { headline: "Checks complete", lead: "The advisor confirms your price.", show: "checklist" };
  if (answer?.ready) return { headline: answer.headline, lead: null, show: "answer" };
  if (answer) return { headline: "The store has your results", lead: answer.text, show: "tick" };
  return { headline: "The store has your results", lead: "Nothing more to do here.", show: "tick" };
}

/**
 * "Trading it in? Clear your phone" (./ClearDataGuide.tsx): with an answer, only once the phone is
 * traded in (final, "Traded in" — R6); while it is still at the counter, "Don't reset it yet"; a
 * repair chosen, a walk-away or a cancelled trade-in shows neither. With no answer (an older
 * server, or none sent), as before: the card once the store has applied the results.
 */
export function clearDataGuide(applied: boolean, answer: AnswerView | null | undefined): "card" | "wait" | null {
  if (!applied) return "wait";
  if (!answer) return "card";
  if (!answer.final) return "wait";
  return answer.ready && answer.headline === "Traded in" ? "card" : null;
}
