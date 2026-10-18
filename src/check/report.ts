// The customer's link to their phone's grade report (grading spec §5, Check app). Once the
// store has applied the results, GET /api/device/status carries `reportPath` — the public
// report page, "/r/<token>", which shows what was tested and why the phone got its grade and
// never a price — and, from a server that sends it, the SwapUp grade itself ("Good (B)").
// The server writes that label (lib/domain/grading.ts, the one letter rule); this file prints it
// as sent, exactly as the store app does (src/store/offer.ts gradeLine).
// No React Native imports: ./report.test.ts runs under plain node.

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

/** After the store applied the results: how often the Done screen asks again, so its grade follows a newer report version. */
export const APPLIED_POLL_MS = 15_000;

/**
 * The Done screen's next status read: every 1.5 s while the advisor checks the screen by eye
 * (the colours are up), every 4 s until the store applies, then every 15 s — a later report
 * version (a Phonecheck result, a desk edit) moves the grade the link already opens, so the
 * phone's line moves with it.
 */
export function donePollMs(r: { status?: unknown; colours?: unknown } | null): number {
  if (r?.status === "applied") return APPLIED_POLL_MS;
  return r?.colours === true ? 1_500 : 4_000;
}
