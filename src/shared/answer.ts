// THE ANSWER, as the server writes it (owner, 2026-10-18: "Current grade C · Market price for grade C
// ₹25,000 · We pay you ₹26,000 + ₹6,199 bonus if you exchange with a new device", and the repair).
// The SERVER writes every word and every number (~/projects/swapup lib/domain/answer.ts; MOBILE-API.md
// §3c `offer.answer`, §4 `GET /api/device/status` → `answer`). SwapUp Check (native and browser) and
// SwapUp Store print the lines as sent, through the one ./AnswerBlock — that is what keeps the
// screens from drifting apart. This file only reads the JSON: it owns no words but TEST_PROGRAMME.
// No React Native imports: ./answer.test.ts runs under plain node.

export type AnswerLineKey = "grade" | "market" | "we_pay" | "bonus" | "repair";
/** One line, word for word. `note` is customer-safe and is printed after " · " in muted ink. */
export type AnswerLine = { key: AnswerLineKey; text: string; note: string | null; amount: number | null };

/** The customer's answer (device status `answer`), or the staff one read the same way. */
export type AnswerView =
  | { ready: false; final: boolean; text: string; test: boolean }
  | { ready: true; final: boolean; headline: string; lines: AnswerLine[]; test: boolean };

/**
 * `offer.answer` on a staff screen: the lines whatever `ready` says (the customer may not see the
 * figures yet — a PriceIQ estimate, an expired quote — but the advisor works from them).
 * `text` = the customer's waiting sentence when not ready.
 */
export type StaffAnswer = { ready: boolean; final: boolean; headline: string | null; lines: AnswerLine[]; text: string | null; test: boolean };

/** Staff-only words under the lines (never in the customer's answer). */
export type StaffNotes = { market: string | null; we_pay: string | null; bonus: string | null };

/** A test programme (the server's org.demo): every surface that shows the lines says so. Same words as ../store/programme.ts. */
export const TEST_PROGRAMME = "Test programme — no real money";

export const LINE_KEYS: readonly AnswerLineKey[] = ["grade", "market", "we_pay", "bonus", "repair"];

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const money = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/**
 * The lines in the server's order, or null when the list is junk. A line of a kind this app
 * doesn't know (a newer server) is dropped; a known line without its words makes the whole list
 * junk — never half an offer. A key sent twice keeps its first line (each number once).
 */
function readLines(x: unknown): AnswerLine[] | null {
  if (!Array.isArray(x)) return null;
  const out: AnswerLine[] = [];
  for (const l of x) {
    const o = obj(l);
    if (!o || typeof o.key !== "string") return null;
    if (!(LINE_KEYS as readonly string[]).includes(o.key)) continue;
    const text = str(o.text);
    if (!text) return null;
    const key = o.key as AnswerLineKey;
    if (out.some((y) => y.key === key)) continue;
    out.push({ key, text, note: str(o.note), amount: money(o.amount) });
  }
  return out;
}

/**
 * The device status's `answer`, or `offer.answer`. undefined = the server sends no answers (an
 * older server: the screen stays as it was); null = none yet, or junk. Never throws. A ready answer
 * needs its headline and at least one line; a waiting one needs its sentence.
 */
export function readAnswer(x: unknown): AnswerView | null | undefined {
  if (x === undefined) return undefined;
  const o = obj(x);
  if (!o || typeof o.ready !== "boolean") return null;
  const final = o.final === true;
  const test = o.test === true;
  if (!o.ready) {
    const text = str(o.text);
    return text ? { ready: false, final, text, test } : null;
  }
  const headline = str(o.headline);
  const lines = readLines(o.lines);
  if (!headline || !lines || !lines.length) return null;
  return { ready: true, final, headline, lines, test };
}

/** `offer.answer` for SwapUp Store: the lines kept whatever `ready` says. null = an older server, or junk. Never throws. */
export function readStaffAnswer(x: unknown): StaffAnswer | null {
  const o = obj(x);
  if (!o || typeof o.ready !== "boolean") return null;
  const lines = readLines(o.lines);
  if (!lines) return null;
  return { ready: o.ready, final: o.final === true, headline: str(o.headline), lines, text: str(o.text), test: o.test === true };
}

/** `offer.answer.staffNotes`: the server's staff-only words for under the lines; each null when absent. */
export function readStaffNotes(x: unknown): StaffNotes {
  const n = obj(obj(x)?.staffNotes);
  return { market: str(n?.market), we_pay: str(n?.we_pay), bonus: str(n?.bonus) };
}

/** The line of one kind, or null. */
export function lineOf(lines: readonly AnswerLine[], key: AnswerLineKey): AnswerLine | null {
  return lines.find((l) => l.key === key) ?? null;
}

/**
 * The side the customer's headline recommends, for the highlight between "Repair" and "Swap up"
 * (the server's headlines, lib/domain/answer.ts). Any other headline ("Either works — your choice",
 * "Your offer", one this app doesn't know) highlights neither.
 */
export function answerSide(headline: string | null | undefined): "repair" | "swap" | null {
  switch (headline) {
    case "Repair it — it's covered":
    case "Repair recommended":
    case "Repair chosen":
      return "repair";
    case "An upgrade is worth considering":
    case "Traded in":
      return "swap";
    default:
      return null;
  }
}
