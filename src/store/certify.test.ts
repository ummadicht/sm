// node --test --experimental-strip-types --no-warnings src/store/certify.test.ts
// "Check the phone" (./certify.ts): the advisor certifies what the store camera couldn't
// decide, one tap per row, by name — the customer is never asked. The server says which rows
// it needs; the app only reads and words it. Same import trick as ./pin.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

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
