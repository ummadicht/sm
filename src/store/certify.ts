// The advisor's certification — SwapUp Store's "Check the phone" (owner, 2026-10-17:
// "the customer is never asked about condition — the camera tests it; when the camera
// can't decide, the advisor certifies it in the store app with one tap, by name, while
// the customer's phone shows the colours").
//
// The server is the judge of everything here; this file only reads what it sends and
// words it. Contract (swapup docs/MOBILE-API.md, "certify"):
//   staff session view and CaseView: certify = {
//     needed: ("screen" | "body" | "liquid")[],          // which rows to show — never guessed here
//     rows: { screen | body | liquid: { value, label, by, at, withColours } | null },
//     colours: "showing" | "waiting" | "old_app" | null, // the customer's phone and the test colours
//     choices?: { row: [{ value, label }] },             // the server's own list wins over ours
//     testSessionId?: string,
//     canEdit?: boolean,                                  // false once the case is past the counter
//   }
//   POST /api/cases/<caseId>/action { action: "certify", row, value, testSessionId } → the CaseView,
//   whose `certification` holds the rows as stored; "All fine" is the one call
//   { action: "certify", allFine: true, testSessionId }.
// A server that sends no `certify` gets no card (an older one): nothing is invented.
//
// No runtime imports — node --test runs it (./certify.test.ts).
import type { Tone } from "./ui";

export type CertifyRow = "screen" | "body" | "liquid";
export const CERTIFY_ROWS: readonly CertifyRow[] = ["screen", "body", "liquid"];

export const ROW_TITLE: Record<CertifyRow, string> = { screen: "Screen", body: "Body", liquid: "Liquid indicator" };

export type CertifyChoice = { value: string; label: string };

/** The choices agreed with the server. A server that lists its own (e.g. with "Scratches") wins. */
export const DEFAULT_CHOICES: Record<CertifyRow, CertifyChoice[]> = {
  screen: [
    { value: "ok", label: "OK" },
    { value: "scratches", label: "Scratches" },
    { value: "lines", label: "Lines or spots" },
    { value: "cracked", label: "Cracked" },
  ],
  body: [
    { value: "like_new", label: "Like new" },
    { value: "scuffs", label: "Scuffs" },
    { value: "dents", label: "Dents" },
    { value: "back_cracked", label: "Back cracked" },
    { value: "bent", label: "Bent" },
  ],
  liquid: [
    { value: "clean", label: "Clean" },
    { value: "tripped", label: "Tripped" },
    { value: "cant_see", label: "Can't see" },
  ],
};

/** Labels for values a server lists without one. */
const KNOWN_LABEL: Record<string, string> = Object.fromEntries(CERTIFY_ROWS.flatMap((r) => DEFAULT_CHOICES[r].map((c) => [c.value, c.label])));

/** How each value reads for the case: good, worth a look, or a fault. */
const VALUE_TONE: Record<string, Tone> = {
  ok: "up",
  like_new: "up",
  clean: "up",
  scratches: "warn",
  scuffs: "warn",
  cant_see: "warn",
  lines: "bad",
  cracked: "bad",
  dents: "bad",
  back_cracked: "bad",
  bent: "bad",
  tripped: "bad",
};

export type Certified = { value: string; label: string; by: string | null; at: string | null; withColours: boolean | null };

export type ColoursState = "showing" | "waiting" | "old_app";

export type CertifyView = {
  /** Rows the server wants certified (camera not final, screen not camera-checked; liquid always). */
  needed: CertifyRow[];
  rows: Partial<Record<CertifyRow, Certified>>;
  colours: ColoursState | null;
  choices: Record<CertifyRow, CertifyChoice[]>;
  testSessionId: string | null;
  /** The server lets staff certify now. Absent = yes (it sent the card); false = shown, not tappable. */
  canEdit: boolean;
  /** Under-row notes from the server (e.g. `notes.screen` when the sweep was partial or skipped, SUP-260). */
  notes?: { screen: string | null };
};

/** True when `notes.screen` warns of a severe mark from a partial display sweep (SUP-260). */
export function severeScreenMark(note: string | null | undefined): boolean {
  return typeof note === "string" && /\(severe[),]/.test(note);
}

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);

function certified(x: unknown): Certified | null {
  const o = obj(x);
  const value = str(o?.value);
  if (!o || !value) return null;
  return {
    value,
    label: str(o.label) ?? KNOWN_LABEL[value] ?? value.replace(/_/g, " "),
    by: str(o.by) ?? str(o.byName) ?? str(o.name),
    at: str(o.at),
    withColours: typeof o.withColours === "boolean" ? o.withColours : null,
  };
}

function choices(x: unknown, row: CertifyRow): CertifyChoice[] {
  if (!Array.isArray(x)) return DEFAULT_CHOICES[row];
  const out: CertifyChoice[] = [];
  for (const c of x) {
    const o = obj(c);
    const value = typeof c === "string" ? str(c) : str(o?.value);
    if (!value || out.some((y) => y.value === value)) continue;
    out.push({ value, label: str(o?.label) ?? KNOWN_LABEL[value] ?? value.replace(/_/g, " ") });
  }
  return out.length ? out : DEFAULT_CHOICES[row];
}

/**
 * The session view or the CaseView → its `certify`, or null when the server sent none.
 * Rows may also come as CaseView.certification (the stored record) — the same shape.
 */
export function readCertify(raw: unknown): CertifyView | null {
  const v = obj(raw);
  const c = obj(v?.certify);
  if (!c) return null;
  const neededRaw = Array.isArray(c.needed) ? c.needed : [];
  const needed = CERTIFY_ROWS.filter((r) => neededRaw.some((n) => n === r));
  const rowsRaw = obj(c.rows) ?? obj(v?.certification) ?? {};
  const rows: Partial<Record<CertifyRow, Certified>> = {};
  for (const r of CERTIFY_ROWS) {
    const e = certified(rowsRaw[r]);
    if (e) rows[r] = e;
  }
  const col = str(c.colours);
  const ch = obj(c.choices);
  const notes = obj(c.notes);
  return {
    needed,
    rows,
    colours: col === "showing" || col === "waiting" || col === "old_app" ? col : null,
    choices: { screen: choices(ch?.screen, "screen"), body: choices(ch?.body, "body"), liquid: choices(ch?.liquid, "liquid") },
    testSessionId: str(c.testSessionId),
    canEdit: c.canEdit !== false,
    notes: { screen: str(notes?.screen) },
  };
}

/**
 * The answer screen (a CaseView): its own `certify` when the server sends one; otherwise the
 * session's (read once, from the Session screen the advisor came from — which rows are
 * needed doesn't change with a tap), with the rows from the case's own `certification`,
 * which every write on the answer screen brings back fresh. No session and no `certify`: no
 * card. The colours line is left out: after Apply the customer's phone isn't showing them.
 */
export function answerCertify(caseRaw: unknown, session: CertifyView | null, sessionId: string | null): CertifyView | null {
  const own = readCertify(caseRaw);
  if (own) return { ...own, testSessionId: own.testSessionId ?? sessionId };
  if (!session) return null;
  const record = obj(obj(caseRaw)?.certification);
  const rows = record ? (readCertify({ certify: { needed: [] }, certification: record })?.rows ?? {}) : session.rows;
  return { ...session, rows, colours: null, testSessionId: session.testSessionId ?? sessionId };
}

/** The rows the card shows: the ones asked for, and any already certified (so a change is one tap). */
export function shownRows(v: CertifyView): CertifyRow[] {
  return CERTIFY_ROWS.filter((r) => v.needed.includes(r) || !!v.rows[r]);
}

/** Asked for and not tapped yet. */
export function pendingRows(v: CertifyView): CertifyRow[] {
  return v.needed.filter((r) => !v.rows[r]);
}

/** "14:02" in this device's time. "" when there is no time. */
export function hhmm(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "✓ Asha · 14:02" — under a tapped row. */
export function stampLine(c: Certified): string {
  const t = hhmm(c.at);
  return `✓ ${c.by ?? "Recorded"}${t ? ` · ${t}` : ""}`;
}

export function valueTone(value: string): Tone {
  return VALUE_TONE[value] ?? "muted";
}

/** The card's opening sentence — the same whichever rows the camera left (the title says the rest). */
export function certifyLead(_v: CertifyView): string {
  return "Tap what you see — your name goes on the report.";
}

/** The line under Screen: where the customer's phone is with the test colours. */
export function coloursLine(v: CertifyView): { text: string; tone: Tone } | null {
  switch (v.colours) {
    case "showing":
      // Tapped before the colours came up: the same tap again records it on them.
      if (v.rows.screen && v.rows.screen.withColours === false) return { text: "Colours showing now — tap the screen again.", tone: "fix" };
      return { text: "Phone shows the test colours.", tone: "up" };
    case "waiting":
      return { text: "Waiting for the test colours…", tone: "fix" };
    case "old_app":
      return { text: "This phone can't show the test colours — check a white and a dark page.", tone: "warn" };
    default:
      return null;
  }
}

/** The camera card's LCD line once the screen is certified: "Certified OK by Asha · 14:02". */
export function certifiedScreenLine(v: CertifyView | null): { text: string; tone: Tone } | null {
  const c = v?.rows.screen;
  if (!c) return null;
  const t = hhmm(c.at);
  return { text: `Certified ${c.label}${c.by ? ` by ${c.by}` : ""}${t ? ` · ${t}` : ""}`, tone: valueTone(c.value) };
}

/**
 * The one tap at the top of the card when the camera couldn't grade the phone and the advisor checks
 * it by eye (owner, 2026-10-19: "Skip and get on advisor app fast"; desk: the same button).
 */
export const ALL_FINE = "All fine — screen OK, body like new";

/**
 * What ALL_FINE taps, in order: Screen OK, Body Like new, and the liquid indicator "Can't see" —
 * honest, it wasn't looked at. The server's own rule (swapup lib/server/cases.ts allFineTaps): only
 * the rows nobody has tapped yet — a row already tapped was looked at and keeps its tap — and the
 * liquid indicator only when the card asks for it. When `notes.screen` warns of a severe mark from a
 * partial sweep (`severeScreenMark`), `"All fine"` leaves the Screen row untapped so the advisor taps
 * it explicitly (SUP-260). The button shows when the desk's does (docs/MOBILE-API.md §8b "while the
 * card is waiting for a tap"; swapup lib/domain/autoApply.ts certifyWaiting, ../flow.ts
 * certifyStillOpen): the camera left the screen or the body, a row asked for is still untapped, and
 * the card can still be tapped — so also on a card that asks only the screen or only the body. And
 * only where the server lists those choices; an empty list = no button. The server, not this list,
 * decides the values: on a row the store camera confirmed worse it records the camera's own chip
 * (allFineBody).
 */
export function allFineTaps(v: CertifyView): { row: CertifyRow; value: string }[] {
  const undecided = v.needed.includes("screen") || v.needed.includes("body");
  if (!v.canEdit || !undecided || !v.needed.some((r) => !v.rows[r])) return [];
  const want: [CertifyRow, string][] = [
    ["screen", "ok"],
    ["body", "like_new"],
    ["liquid", "cant_see"],
  ];
  const taps: { row: CertifyRow; value: string } = [] as never;
  const out: { row: CertifyRow; value: string }[] = [];
  void taps;
  for (const [row, value] of want) {
    if (row === "liquid" && !v.needed.includes("liquid")) continue;
    if (row === "screen" && severeScreenMark(v.notes?.screen)) continue;
    if (!v.choices[row].some((c) => c.value === value)) return [];
    if (!v.rows[row]) out.push({ row, value });
  }
  return out;
}

/* ── the card's own state between a tap and the server's answer (./screens/CertifyCard.tsx) ── */

/** How long a tap shows as chosen while the server's answer is on its way back to the screen. */
export const TAPPED_MS = 6000;

/** The taps on their way (a chip shows as chosen until the server's view has it), and the server's refusal under each row. */
export type CardTaps = {
  tapped: Partial<Record<CertifyRow, { value: string; at: number }>>;
  err: Partial<Record<CertifyRow, string>>;
};
export const NO_TAPS: CardTaps = { tapped: {}, err: {} };

/** A tap sent: its chip shows as chosen, and the row's last refusal goes. */
export function tapSent(s: CardTaps, row: CertifyRow, value: string, at: number): CardTaps {
  const err = { ...s.err };
  delete err[row];
  return { tapped: { ...s.tapped, [row]: { value, at } }, err };
}

/** The chip let go: the row shows what the server holds again. */
export function letGo(s: CardTaps, row: CertifyRow): CardTaps {
  if (!s.tapped[row]) return s;
  const tapped = { ...s.tapped };
  delete tapped[row];
  return { ...s, tapped };
}

/**
 * The server's answer to one tap. Recorded (null): nothing changes here — its view brings the row.
 * Refused (its sentence): the sentence under the row, word for word, and the chip let go, so the row
 * shows what the server holds. That is how a tap better than what the camera found is told (SUP-5):
 * the server answers 409 with the camera's sentence and records nothing, so the row stays untapped
 * and says why — never a generic failure, never a tap that looks taken.
 */
export function tapAnswered(s: CardTaps, row: CertifyRow, why: string | null): CardTaps {
  if (!why) return s;
  return { ...letGo(s, row), err: { ...s.err, [row]: why } };
}

/** The server's view moved on: a chip it now holds, or one held too long, is let go. Unchanged → the same object. */
export function tapsSettled(s: CardTaps, v: CertifyView, now: number, maxMs: number = TAPPED_MS): CardTaps {
  let out = s;
  for (const r of Object.keys(s.tapped) as CertifyRow[]) {
    const t = s.tapped[r]!;
    if (v.rows[r]?.value === t.value || now - t.at > maxMs) out = letGo(out, r);
  }
  return out;
}

/**
 * What one row shows: the chip chosen ("" = none), the stamp on the right ("✓ Asha · 14:02") or
 * "Not checked yet" when the row is asked for and has none, and the server's refusal under it.
 */
export function rowFace(v: CertifyView, row: CertifyRow, s: CardTaps): { chosen: string; stamp: string | null; notChecked: boolean; error: string | null } {
  const entry = v.rows[row] ?? null;
  const held = s.tapped[row];
  const stamp = entry && !held ? stampLine(entry) : null;
  return { chosen: held?.value ?? entry?.value ?? "", stamp, notChecked: !stamp && v.needed.includes(row), error: s.err[row] ?? null };
}

/** The POST body for one tap. */
export function certifyBody(row: CertifyRow, value: string, testSessionId: string | null): Record<string, unknown> {
  return { action: "certify", row, value, ...(testSessionId ? { testSessionId } : {}) };
}

/**
 * The POST body for ALL_FINE: ONE call, as the desk sends it (docs/MOBILE-API.md "One tap") — never
 * its three taps one by one. The server taps the rows nobody has tapped yet in one transaction, and
 * on a row the store camera confirmed worse records the camera's own chip instead of refusing — a
 * single "OK" / "Like new" tap there is refused (SUP-5).
 */
export function allFineBody(testSessionId: string | null): Record<string, unknown> {
  return { action: "certify", allFine: true, ...(testSessionId ? { testSessionId } : {}) };
}

/** ALL_FINE sent: the rows it taps lose their last refusal — the server answers for them now. */
export function allFineSent(s: CardTaps, v: CertifyView): CardTaps {
  const rows = allFineTaps(v).map((t) => t.row);
  if (!rows.some((r) => s.err[r])) return s;
  const err = { ...s.err };
  for (const r of rows) delete err[r];
  return { ...s, err };
}
