// node --test --experimental-strip-types --no-warnings src/store/certify.test.ts
// "Check the phone" (./certify.ts): the advisor certifies what the store camera couldn't
// decide, one tap per row, by name — the customer is never asked. The server says which rows
// it needs; the app only reads and words it. Same import trick as ./pin.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// ./staffClient imports ../shared/api without an extension (Metro's way); this adds ".ts" for plain node.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); }
        catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]sx?$/.test(s)) return next(s + ".ts", c); throw e; }
      }`
    )
);

const C: typeof import("./certify") = await import("./certify" + ".ts");
const G: typeof import("../shared/nameGuard") = await import("../shared/nameGuard" + ".ts");

const AT = "2026-10-17T08:32:00.000Z";
const local = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

test("readCertify: no `certify` from the server → no card, nothing invented", () => {
  assert.equal(C.readCertify(null), null);
  assert.equal(C.readCertify({ id: "ts_1", status: "complete" }), null, "an older server");
  assert.equal(C.readCertify({ certify: "yes" }), null);
});

test("readCertify: the rows the server asks for, in screen · body · liquid order, and the taps so far", () => {
  const v = C.readCertify({
    certify: {
      needed: ["liquid", "screen", "dancing", "screen"],
      rows: { screen: { value: "ok", label: "OK", by: "Asha K.", at: AT, withColours: true }, body: { value: "nope" }, liquid: { label: "no value" } },
      colours: "showing",
      testSessionId: "ts_9",
    },
  })!;
  assert.deepEqual(v.needed, ["screen", "liquid"], "unknown rows dropped, no repeats, fixed order");
  assert.deepEqual(v.rows.screen, { value: "ok", label: "OK", by: "Asha K.", at: AT, withColours: true });
  assert.equal(v.rows.body?.label, "nope", "a value the app doesn't know is shown as the server wrote it, never dropped");
  assert.equal(v.rows.liquid, undefined, "no value, no certification");
  assert.equal(v.colours, "showing");
  assert.equal(v.testSessionId, "ts_9");
  assert.equal(v.canEdit, true, "the server sent the card: it can be tapped unless it says otherwise");
  assert.deepEqual(C.shownRows(v), ["screen", "body", "liquid"], "asked for, or already certified");
  assert.deepEqual(C.pendingRows(v), ["liquid"]);
  // A row certified earlier stays on the card even when the server no longer needs it (a change is one tap).
  const later = C.readCertify({ certify: { needed: ["liquid"], rows: { screen: { value: "lines", by: "Asha K.", at: AT } } } })!;
  assert.deepEqual(C.shownRows(later), ["screen", "liquid"]);
  assert.equal(later.rows.screen?.label, "Lines or spots");
  // The case's stored record (CaseView.certification) reads the same.
  assert.equal(C.readCertify({ certify: { needed: ["body"] }, certification: { body: { value: "scuffs", by: "Ravi" } } })?.rows.body?.label, "Scuffs");
  assert.equal(C.readCertify({ certify: { needed: [], canEdit: false } })?.canEdit, false);
  assert.equal(C.readCertify({ certify: { needed: [], colours: "rainbow" } })?.colours, null);
});

test("choices: one tap per row — ours by default, the server's own list when it sends one", () => {
  const v = C.readCertify({ certify: { needed: ["screen", "body", "liquid"] } })!;
  assert.deepEqual(v.choices.screen.map((c) => c.label), ["OK", "Scratches", "Lines or spots", "Cracked"], "the server's own four, word for word");
  assert.deepEqual(v.choices.body.map((c) => c.value), ["like_new", "scuffs", "dents", "back_cracked", "bent"]);
  assert.deepEqual(v.choices.liquid.map((c) => c.label), ["Clean", "Tripped", "Can't see"]);
  const own = C.readCertify({ certify: { needed: ["screen"], choices: { screen: ["ok", { value: "scratches" }, { value: "lines", label: "Lines" }, "ok", 7], body: [] } } })!;
  assert.deepEqual(own.choices.screen, [
    { value: "ok", label: "OK" },
    { value: "scratches", label: "Scratches" },
    { value: "lines", label: "Lines" },
  ]);
  assert.deepEqual(own.choices.body, C.DEFAULT_CHOICES.body, "an empty list is no list");
});

test("the words: who and when, the lead, the colours line, the camera card's LCD line", () => {
  const ok = { value: "ok", label: "OK", by: "Asha K.", at: AT, withColours: true };
  assert.equal(C.stampLine(ok), `✓ Asha K. · ${local(AT)}`);
  assert.equal(C.stampLine({ ...ok, at: null }), "✓ Asha K.");
  assert.equal(C.stampLine({ ...ok, by: null, at: "junk" }), "✓ Recorded");
  assert.equal(C.hhmm(null), "");
  const camera = C.readCertify({ certify: { needed: ["screen", "body", "liquid"] } })!;
  assert.equal(C.certifyLead(camera), "Tap what you see — your name goes on the report.");
  assert.equal(C.certifyLead(C.readCertify({ certify: { needed: ["liquid"] } })!), "Tap what you see — your name goes on the report.");
  assert.equal(C.coloursLine({ ...camera, colours: "showing" })?.text, "Phone shows the test colours.");
  assert.equal(C.coloursLine({ ...camera, colours: "waiting" })?.text, "Waiting for the test colours…");
  assert.match(C.coloursLine({ ...camera, colours: "old_app" })!.text, /can't show the test colours/);
  assert.equal(C.coloursLine(camera), null);
  assert.deepEqual(C.certifiedScreenLine({ ...camera, rows: { screen: ok } }), { text: `Certified OK by Asha K. · ${local(AT)}`, tone: "up" });
  assert.equal(C.certifiedScreenLine({ ...camera, rows: { screen: { ...ok, value: "cracked", label: "Cracked" } } })?.tone, "bad");
  assert.equal(C.certifiedScreenLine(camera), null);
  assert.equal(C.certifiedScreenLine(null), null);
  assert.equal(C.valueTone("scuffs"), "warn");
  assert.equal(C.valueTone("mystery"), "muted");
});

test("answerCertify: the answer screen uses the case's own card, else the session's rows needed with the case's record", () => {
  const session = C.readCertify({ certify: { needed: ["screen", "body", "liquid"], rows: { liquid: { value: "clean", by: "A", at: AT } }, colours: "showing" } })!;
  // The CaseView carries only its stored record (`certification`): the session says what's needed.
  const a = C.answerCertify({ id: "c1", certification: { screen: { value: "ok", label: "OK", by: "Asha K.", at: AT, withColours: true } } }, session, "ts_1")!;
  assert.deepEqual(a.needed, ["screen", "body", "liquid"]);
  assert.equal(a.rows.screen?.by, "Asha K.", "the case's fresh record wins");
  assert.equal(a.rows.liquid, undefined, "the record is the truth: what it doesn't hold isn't certified");
  assert.equal(a.colours, null, "after Apply the phone isn't showing the colours");
  assert.equal(a.testSessionId, "ts_1");
  assert.deepEqual(C.answerCertify({ id: "c1" }, session, "ts_1")!.rows, session.rows, "no record on the case: the session's");
  // A CaseView with its own `certify` is used as it is.
  const own = C.answerCertify({ certify: { needed: ["liquid"] } }, session, "ts_1")!;
  assert.deepEqual(own.needed, ["liquid"]);
  assert.equal(own.testSessionId, "ts_1");
  assert.equal(C.answerCertify({ id: "c1" }, null, null), null, "nothing says what's needed: no card");
});

test("allFineTaps: one tap for a full check by eye — Screen OK, Body Like new, Liquid Can't see (not looked at)", () => {
  const full = C.readCertify({ certify: { needed: ["screen", "body", "liquid"], rows: {}, colours: "showing", testSessionId: "ts_9" } })!;
  assert.equal(C.ALL_FINE, "All fine — screen OK, body like new");
  assert.deepEqual(C.allFineTaps(full), [
    { row: "screen", value: "ok" },
    { row: "body", value: "like_new" },
    { row: "liquid", value: "cant_see" },
  ]);
  // Sent as ONE call, as the desk's (docs/MOBILE-API.md "One tap") — never its taps one by one.
  assert.deepEqual(C.allFineBody(full.testSessionId), { action: "certify", allFine: true, testSessionId: "ts_9" });
  assert.deepEqual(C.allFineBody(null), { action: "certify", allFine: true });
  // A row already tapped was looked at and keeps its tap (the server's allFineTaps): only the rest.
  const looked = C.readCertify({ certify: { needed: ["screen", "body", "liquid"], rows: { liquid: { value: "clean", by: "Asha", at: AT }, body: { value: "like_new", by: "Asha", at: AT } } } })!;
  assert.deepEqual(C.allFineTaps(looked), [{ row: "screen", value: "ok" }]);
  const scuffed = C.readCertify({ certify: { needed: ["screen", "body", "liquid"], rows: { body: { value: "scuffs", by: "Asha", at: AT } } } })!;
  assert.deepEqual(C.allFineTaps(scuffed).map((t) => t.row), ["screen", "liquid"], "the body keeps its Scuffs");
  // The liquid indicator only when the card asks for it.
  const dry = C.readCertify({ certify: { needed: ["screen", "body"] } })!;
  assert.deepEqual(C.allFineTaps(dry).map((t) => t.row), ["screen", "body"]);
});

test("allFineTaps: no button unless it is a full check by eye the advisor can still tap, with those choices", () => {
  const card = (c: Record<string, unknown>) => C.readCertify({ certify: { needed: ["screen", "body", "liquid"], ...c } })!;
  assert.deepEqual(C.allFineTaps(card({ needed: ["screen", "liquid"] })), [], "the camera graded the body");
  assert.deepEqual(C.allFineTaps(card({ needed: ["liquid"] })), []);
  assert.deepEqual(C.allFineTaps(card({ canEdit: false })), [], "past the counter");
  assert.deepEqual(C.allFineTaps(card({ choices: { body: ["scuffs", "dents"] } })), [], "the server's list has no 'like new'");
  const done = card({ rows: { screen: { value: "ok" }, body: { value: "like_new" }, liquid: { value: "cant_see" } } });
  assert.deepEqual(C.allFineTaps(done), [], "nothing would change");
  // Every row tapped, whatever with: the server would tap nothing, so no button that does nothing.
  const tapped = card({ rows: { screen: { value: "scratches" }, body: { value: "dents" }, liquid: { value: "tripped" } } });
  assert.deepEqual(C.allFineTaps(tapped), []);
});

test("certifyBody: the one-door case action, with the session when known", () => {
  assert.deepEqual(C.certifyBody("screen", "ok", "ts_1"), { action: "certify", row: "screen", value: "ok", testSessionId: "ts_1" });
  assert.deepEqual(C.certifyBody("liquid", "cant_see", null), { action: "certify", row: "liquid", value: "cant_see" });
});

test("no engine or partner names in the advisor's words", () => {
  const v = C.readCertify({ certify: { needed: ["screen", "body", "liquid"], colours: "old_app" } })!;
  const words = [C.certifyLead(v), C.coloursLine(v)!.text, ...Object.values(C.ROW_TITLE), ...C.CERTIFY_ROWS.flatMap((r) => v.choices[r].map((c) => c.label))].join(" ");
  assert.doesNotMatch(words, /GradeIQ|Gemini|402|credit/i);
  assert.equal(G.namesPartner(words), false, "nor the buyback partner");
});

// Copied from the SwapUp dev server (2026-10-17, case SU-AND-00127, choices trimmed): the
// session view while the customer's phone shows the colours, and the CaseView after the three
// taps — the shapes this app must read, exactly as the server sends them.
const LIVE_CHOICES = {
  screen: [{ value: "ok", label: "OK" }, { value: "scratches", label: "Scratches" }, { value: "lines", label: "Lines or spots" }, { value: "cracked", label: "Cracked" }],
  body: [{ value: "like_new", label: "Like new" }, { value: "scuffs", label: "Scuffs" }, { value: "dents", label: "Dents" }, { value: "back_cracked", label: "Back cracked" }, { value: "bent", label: "Bent" }],
  liquid: [{ value: "clean", label: "Clean" }, { value: "tripped", label: "Tripped" }, { value: "cant_see", label: "Can't see" }],
};
const LIVE_SESSION = {
  status: "complete",
  phonePhase: "colours",
  certify: { needed: ["screen", "body", "liquid"], rows: { screen: null, body: null, liquid: null }, choices: LIVE_CHOICES, colours: "showing", testSessionId: "ts_8ylRW-uYkG-4DECZ", canEdit: true },
};
const ROWS = {
  screen: { value: "ok", label: "OK", by: "Rahul Desai", at: "2026-10-18T02:35:37.841Z", withColours: true },
  body: { value: "back_cracked", label: "Back cracked", by: "Rahul Desai", at: "2026-10-18T02:35:37.888Z", withColours: true },
  liquid: { value: "clean", label: "Clean", by: "Rahul Desai", at: "2026-10-18T02:35:37.924Z", withColours: true },
};
const LIVE_CASE = {
  certify: { needed: ["screen", "body", "liquid"], rows: ROWS, choices: LIVE_CHOICES, colours: "off", testSessionId: "ts_8ylRW-uYkG-4DECZ", canEdit: true },
  certification: ROWS,
};

test("the server's real shapes: session card while the colours show, then the case's own card after the taps", () => {
  const s = C.readCertify(LIVE_SESSION)!;
  assert.deepEqual(C.shownRows(s), ["screen", "body", "liquid"]);
  assert.deepEqual(C.pendingRows(s), ["screen", "body", "liquid"]);
  assert.equal(s.colours, "showing");
  assert.equal(C.coloursLine(s)?.text, "Phone shows the test colours.");
  assert.equal(s.testSessionId, "ts_8ylRW-uYkG-4DECZ");
  assert.deepEqual(C.certifyBody("screen", "ok", s.testSessionId), { action: "certify", row: "screen", value: "ok", testSessionId: "ts_8ylRW-uYkG-4DECZ" });

  // The answer screen opened from Home (no session read): the CaseView's own card.
  const a = C.answerCertify(LIVE_CASE, null, null)!;
  assert.deepEqual(C.pendingRows(a), []);
  assert.equal(a.colours, null, "\"off\" draws no colours line");
  assert.equal(a.canEdit, true);
  assert.equal(a.rows.body?.label, "Back cracked");
  assert.match(C.certifiedScreenLine(a)!.text, /^Certified OK by Rahul Desai · \d\d:\d\d$/);
  // Past the counter the server says canEdit false: shown, not tappable.
  assert.equal(C.readCertify({ ...LIVE_CASE, certify: { ...LIVE_CASE.certify, canEdit: false } })!.canEdit, false);
});

// ── SUP-5: a tap better than what the camera found ───────────────────────────────────────────────
// The server answers 409 {error: "<the camera's sentence>"} and records nothing. Both screens send
// the tap through the staff client and hand the card errText(e) (Session.certifyTap; Offer's write
// queue) — the card puts that sentence under the row and leaves the row as the server holds it.

// The server's own sentence, as it words it now (swapup lib/domain/certify.ts certifyAgainstCamera,
// gradeiqMap.ts floorProblems): what the camera confirmed, in the condition's words, quoted; then the
// chip the advisor tapped, quoted by its own label — the one on this card (LIVE_CHOICES); then where
// the reason goes (REASON_ON_DESK).
const REASON_ON_DESK = "needs a reason, given on the desk's What's wrong once the answer is open.";
const CAMERA_SAYS = 'Camera confirmed the screen "Lines, spots or dead pixels" — "OK" needs a reason, given on the desk\'s What\'s wrong once the answer is open.';
const CAMERA_SAYS_BODY = 'Camera confirmed the body "Back glass cracked" — "Dents" needs a reason, given on the desk\'s What\'s wrong once the answer is open.';
/** The chip a refusal quotes: the second quoted value. */
const quotedTap = (why: string) => why.match(/ — "([^"]+)" needs a reason/)?.[1];

test("SUP-5: the camera's sentence quotes the chip the advisor tapped, by the label on the card", () => {
  const label = (row: "screen" | "body", value: string) => LIVE_CHOICES[row].find((c) => c.value === value)?.label;
  assert.equal(quotedTap(CAMERA_SAYS), label("screen", "ok"));
  assert.equal(quotedTap(CAMERA_SAYS_BODY), label("body", "dents"));
  // The camera's finding quoted, then the chip's label quoted, then where the reason goes.
  assert.equal(CAMERA_SAYS, `Camera confirmed the screen "Lines, spots or dead pixels" — "${label("screen", "ok")}" ${REASON_ON_DESK}`);
  assert.equal(CAMERA_SAYS_BODY, `Camera confirmed the body "Back glass cracked" — "${label("body", "dents")}" ${REASON_ON_DESK}`);
});

test("SUP-5: the camera overrules a tap — its sentence, word for word, under the row; the row stays untapped", async () => {
  const S: typeof import("./staffClient") = await import("./staffClient" + ".ts");
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: CAMERA_SAYS }), { status: 409, headers: { "content-type": "application/json" } })) as typeof fetch;
  let signedOut = false;
  const why = await S.staffClient("https://swapup.example.in", "tok", () => (signedOut = true))
    .post("/api/cases/c1/action", C.certifyBody("screen", "ok", "ts_1"))
    .then(() => null, (e: unknown) => S.errText(e));
  assert.equal(why, CAMERA_SAYS, "the server's sentence, not a generic failure");
  assert.equal(signedOut, false);

  // The card: Screen asked for, nothing tapped yet.
  const v = C.readCertify({ certify: { needed: ["screen", "body", "liquid"], colours: "showing" } })!;
  const before = C.rowFace(v, "screen", C.NO_TAPS);
  assert.deepEqual(before, { chosen: "", stamp: null, notChecked: true, error: null });
  // Tapped: the chip shows as chosen while the answer is on its way.
  const sent = C.tapSent(C.NO_TAPS, "screen", "ok", 1_000);
  assert.equal(C.rowFace(v, "screen", sent).chosen, "ok");
  // Refused: the sentence under the row, the chip let go — the row is as it was, untapped.
  const refused = C.tapAnswered(sent, "screen", why);
  assert.deepEqual(C.rowFace(v, "screen", refused), { chosen: "", stamp: null, notChecked: true, error: CAMERA_SAYS });
  assert.deepEqual(C.pendingRows(v), ["screen", "body", "liquid"], "nothing was recorded");
  // The server's view comes back unchanged: the sentence stays; the other rows are untouched.
  assert.equal(C.tapsSettled(refused, v, 2_000), refused);
  assert.deepEqual(C.rowFace(v, "body", refused), { chosen: "", stamp: null, notChecked: true, error: null });
  // The advisor taps what the camera saw: the old sentence goes.
  const again = C.tapSent(refused, "screen", "lines", 3_000);
  assert.equal(C.rowFace(v, "screen", again).error, null);
  assert.equal(C.rowFace(v, "screen", again).chosen, "lines");
});

test("All fine is ONE call: on a row the camera confirmed worse the server records the camera's chip — no refusal", async () => {
  const S: typeof import("./staffClient") = await import("./staffClient" + ".ts");
  // The server, as it answers on a session whose camera confirmed lines on the screen: a single "OK"
  // tap is refused with the camera's sentence; {allFine: true} taps every untapped row, the screen
  // with the camera's own chip.
  const sent: unknown[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    sent.push(b);
    if (b.allFine === true) {
      const by = { by: "Asha K.", at: AT, withColours: true };
      const rows = { screen: { value: "lines", label: "Lines or spots", ...by }, body: { value: "like_new", label: "Like new", ...by }, liquid: { value: "cant_see", label: "Can't see", ...by } };
      return new Response(JSON.stringify({ id: "c1", certify: { needed: ["screen", "body", "liquid"], rows, colours: "off", testSessionId: "ts_1" }, certification: rows }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: CAMERA_SAYS }), { status: 409, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const api = S.staffClient("https://swapup.example.in", "tok", () => {});
  const send = (body: Record<string, unknown>) => api.post<unknown>("/api/cases/c1/action", body).then((r) => ({ r, why: null }), (e: unknown) => ({ r: null, why: S.errText(e) }));

  const v = C.readCertify({ certify: { needed: ["screen", "body", "liquid"], colours: "showing", testSessionId: "ts_1" } })!;
  // A single tap keeps its refusal: the camera's sentence under the row.
  const one = await send(C.certifyBody("screen", "ok", v.testSessionId));
  assert.equal(one.why, CAMERA_SAYS);
  const refused = C.tapAnswered(C.tapSent(C.NO_TAPS, "screen", "ok", 1_000), "screen", one.why);
  assert.equal(C.rowFace(v, "screen", refused).error, CAMERA_SAYS);

  // All fine: one request, the allFine body — not three taps.
  sent.length = 0;
  const cleared = C.allFineSent(refused, v);
  assert.equal(C.rowFace(v, "screen", cleared).error, null, "the server answers for the screen now");
  const all = await send(C.allFineBody(v.testSessionId));
  assert.equal(all.why, null, "never refused for what the camera confirmed");
  assert.deepEqual(sent, [{ action: "certify", allFine: true, testSessionId: "ts_1" }]);
  // The server's view brings the rows: the screen says what the camera saw, nothing left to tap.
  const after = C.readCertify(all.r)!;
  assert.deepEqual(C.pendingRows(after), []);
  assert.equal(C.rowFace(after, "screen", cleared).chosen, "lines");
  assert.match(C.rowFace(after, "screen", cleared).stamp ?? "", /^✓ Asha K\./);
  assert.deepEqual(C.allFineTaps(after), [], "no button once every row is tapped");
  // Nothing to clear: the same object.
  assert.equal(C.allFineSent(C.NO_TAPS, v), C.NO_TAPS);
});

test("the card's taps: recorded → the server's view takes over; held too long → let go; an earlier stamp stays", () => {
  const v = C.readCertify({ certify: { needed: ["screen", "body"], rows: { body: { value: "like_new", label: "Like new", by: "Asha K.", at: AT } } } })!;
  const sent = C.tapSent(C.NO_TAPS, "screen", "ok", 1_000);
  assert.equal(C.tapAnswered(sent, "screen", null), sent, "recorded: nothing to change here");
  const recorded = { ...v, rows: { ...v.rows, screen: { value: "ok", label: "OK", by: "Asha K.", at: AT, withColours: true } } };
  assert.deepEqual(C.tapsSettled(sent, recorded, 1_500), C.NO_TAPS, "the server's view has it");
  assert.equal(C.rowFace(recorded, "screen", C.NO_TAPS).stamp, `✓ Asha K. · ${local(AT)}`);
  assert.equal(C.tapsSettled(sent, v, 1_000 + C.TAPPED_MS), sent, "not yet");
  assert.deepEqual(C.tapsSettled(sent, v, 1_001 + C.TAPPED_MS), C.NO_TAPS, "held too long");
  // A refused re-tap of a certified row: the stamp it had is back, with the sentence.
  const face = C.rowFace(v, "body", C.tapAnswered(C.tapSent(C.NO_TAPS, "body", "dents", 1), "body", CAMERA_SAYS_BODY));
  assert.deepEqual(face, { chosen: "like_new", stamp: `✓ Asha K. · ${local(AT)}`, notChecked: false, error: CAMERA_SAYS_BODY });
});
