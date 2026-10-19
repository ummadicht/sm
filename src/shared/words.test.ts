// node --test --experimental-strip-types --no-warnings src/shared/words.test.ts
// The owner, 2026-10-17, on a real phone: "reduce the words". Every sentence the apps write
// themselves is ONE short sentence (≤ 15 words), every button 1–3 words. This guards the
// app-owned sentences in the pure modules (the screens' own words are checked by reading them);
// the server's strings are shortened at their source. Same import trick as ../store/buySell.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const F: typeof import("../store/flow") = await import("../store/flow" + ".ts");
const L: typeof import("../store/phoneLed") = await import("../store/phoneLed" + ".ts");
const C: typeof import("../store/certify") = await import("../store/certify" + ".ts");
const K: typeof import("../store/lock") = await import("../store/lock" + ".ts");
const O: typeof import("../store/offer") = await import("../store/offer" + ".ts");
const N: typeof import("../store/pin") = await import("../store/pin" + ".ts");

const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
/** A sentence end followed by another sentence ("Done. Next…") — "e.g." and "*#06#." don't count. */
const sentences = (s: string) => 1 + (s.match(/[.!?…]\s+[A-Z]/g) ?? []).length;

function short(list: string[], max = 15) {
  for (const s of list) {
    assert.ok(words(s) <= max, `${words(s)} words: ${s}`);
    assert.equal(sentences(s), 1, `more than one sentence: ${s}`);
  }
}

test("the Session screen's top line and step 4: one short sentence each", () => {
  const base = { caseRef: "SU-AND-00140", progress: { done: 3, total: 12 }, joinedAt: "2026-10-17T10:00:00.000Z", layout: "scanFirst" as const, phase: null, certify: null, certifyShown: false, phoneLine: null };
  const autos = [null, { state: "ready" }, { state: "applied" }, { state: "refused", reason: "x" }, { state: "waiting", for: "certify", text: "" }, { state: "waiting", for: "camera", text: "" }] as const;
  const lines: string[] = [];
  for (const status of ["waiting", "opened", "joined", "testing", "complete", "applied", "expired", "cancelled"]) {
    for (const a of autos) {
      lines.push(F.sessionNow({ ...base, status, autoApply: a }).text, F.answerStepText(status, a));
      lines.push(F.sessionNow({ ...base, status, autoApply: a, certifyShown: true }).text);
    }
  }
  lines.push(F.sessionNow({ ...base, status: "complete", phase: "colours", autoApply: { state: "waiting", for: "certify", text: "" } }).text);
  lines.push(F.sessionNow({ ...base, status: "expired", joinedAt: null, autoApply: null }).text);
  short(lines.filter((x) => x !== "x"));
});

test("the phone-led line while the customer's phone leads", () => {
  const out: string[] = [];
  for (const status of ["waiting", "joined", "testing", "complete"])
    for (const phase of [null, "identify", "scan", "battery", "test", "done", "colours"] as const)
      for (const stage of ["off", "setup", "waiting", "now", "done", "skipped"] as const) {
        const l = L.scanFirstNow({ status, progress: { done: 3, total: 12 } }, phase, stage);
        if (l) out.push(l.text);
      }
  short(out);
});

test("Check the phone: the lead, the colours line, row titles and chips", () => {
  const v = C.readCertify({ certify: { needed: ["screen", "body", "liquid"] } })!;
  short([C.certifyLead(v), ...(["showing", "waiting", "old_app"] as const).map((c) => C.coloursLine({ ...v, colours: c })!.text)]);
  for (const t of Object.values(C.ROW_TITLE)) assert.ok(words(t) <= 3, t);
  for (const r of C.CERTIFY_ROWS) for (const c of C.DEFAULT_CHOICES[r]) assert.ok(words(c.label) <= 3, c.label);
});

test("Take the trade-in: every problem the form can say, and the KYM line", () => {
  const head = { variant: "512GB", variantSource: "customer" as const, imei: "356789012345678", imei2: "356789012345686", imeiCheck: "invalid" as const, imei2Check: null, lockBlockers: [] };
  const filled: import("../store/lock").LockForm = { name: "Ravi Kumar", phone: "9876543210", idType: "pan", idLast4: "1234", kym: "clear", kymRef: "", handover: true, storageSeen: true, imeiCheckAck: true };
  const steps: Partial<import("../store/lock").LockForm>[] = [{ name: "" }, { phone: "1" }, { idType: "" }, { idLast4: "1" }, { kym: "" }, { kym: "blacklisted" }, { handover: false }, { storageSeen: false }, { imeiCheckAck: false }];
  const out = steps.map((s) => K.lockProblem({ ...filled, ...s }, head)!).filter(Boolean);
  out.push(K.lockProblem({ ...filled, kym: "" }, { ...head, imei: null })!);
  out.push(K.kymText(head), K.kymText({ imei: null, imei2: null }), K.HANDOVER_HINT, K.IMEI_MISSING);
  assert.equal(out.length, 14, "every step said something");
  short(out);
});

test("the answer's own words: the pill, the hand-off buttons, the Phonecheck notes, the grade notes", () => {
  for (const t of [O.storageHandoff({ measuredStorage: "1TB" }).title, O.storageHandoff({ measuredStorage: null }).title]) assert.ok(words(t) <= 3, t);
  short([O.ACTION_UNKNOWN, O.LETTER_NOTE, O.SCALE_NOTE, ...Object.values(O.PULL_TEXT), O.vsRepairLine(95904)!, O.vsRepairLine(-4500)!, O.vsRepairLine(0)!]);
  assert.ok(words(O.CHOOSE_PHONE) <= 4, O.CHOOSE_PHONE);
});

test("the answer's lines and waiting sentences (the server's, as the fixtures hold them): one short sentence each", async () => {
  const F: typeof import("./answer.fixtures") = await import("./answer.fixtures" + ".ts");
  const out: string[] = [];
  for (const a of [F.F1, F.F3, F.F4, F.F5, F.F6, F.F8, F.F9, F.WALKED_AWAY] as { lines: { text: string; note: string | null }[] }[]) {
    for (const l of a.lines) out.push(l.text, ...(l.note ? [l.note] : []));
  }
  out.push(F.F2.text, F.F2_ESTIMATE.text, F.CANCELLED.text);
  assert.ok(out.length > 30);
  short(out);
});

test("PIN and tablet-name messages", () => {
  short([N.pinProblem("1234")!, N.newPinProblem("4826", "4862")!, N.deviceNameProblem("x")!]);
});

test("the Check app's privacy line is one short sentence, the same on the native and the browser screens", async () => {
  const W: typeof import("../check/copy") = await import("../check/copy" + ".ts");
  short([W.PRIVACY_LINE]);
  const { readFileSync } = await import("node:fs");
  for (const f of ["../check/GetReady.tsx", "../check/screens.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /\{PRIVACY_LINE\}/, `${f} uses the one constant`);
    assert.doesNotMatch(src, /No photos, contacts, messages/, `${f}: the long paragraph is gone`);
  }
});

test("sign-up and the blocked-tab screens: one short sentence per banner", async () => {
  const { readFileSync } = await import("node:fs");
  const said = (f: string, title: string) => {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    const at = src.indexOf(title);
    assert.ok(at >= 0, `${f}: ${title}`);
    const body = src.slice(src.indexOf(">", at) + 1, src.indexOf("</Banner>", at)).replace(/\s+/g, " ").trim();
    return body;
  };
  short([
    said("../store/screens/SignUp.tsx", `title="Your store starts as 'waiting for approval'"`),
    said("../store/screens/SignUp.tsx", `title="No programme is open for new stores"`),
    said("../store/screens/Web.web.tsx", `title="This sign-in link has expired"`),
  ]);
  const web = readFileSync(new URL("../store/screens/Web.web.tsx", import.meta.url), "utf8");
  assert.match(web, /<Body>New tab blocked — tap to open the desk\.<\/Body>/);
});
