// node --test --experimental-strip-types --no-warnings src/store/lock.test.ts
// TAKE THE TRADE-IN: the store app's form against the desk's (~/projects/swapup
// components/counter/LockForm.tsx) and the server's lockTradeIn. Same import trick as ./pin.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const K: typeof import("./lock") = await import("./lock" + ".ts");
type LockForm = import("./lock").LockForm;
type LockHead = import("./lock").LockHead;

const head = (over: Partial<LockHead> = {}): LockHead => ({
  variant: "256GB",
  variantSource: "measured",
  imei: "356789012345678",
  imei2: null,
  imeiCheck: "valid",
  imei2Check: null,
  lockBlockers: [],
  ...over,
});

/** A form the server would accept for a measured phone. */
const filled = (over: Partial<LockForm> = {}): LockForm => ({
  ...K.emptyLockForm({ customerName: "Ravi Kumar", customerPhone: "98765 43210" }),
  idType: "aadhaar",
  idLast4: "ab12",
  kym: "clear",
  kymRef: "  SMS 10:42  ",
  handover: true,
  ...over,
});

const STORAGE = "Check Settings › About phone shows 512GB.";
const IMEI_ACK = "An IMEI fails its check digit — re-read *#06#.";

test("constants: the desk's words", () => {
  assert.deepEqual(
    K.ID_TYPES.map((t) => t.id),
    ["aadhaar", "pan", "driving_licence", "voter_id", "passport"]
  );
  assert.equal(K.ID_TYPES[0].label, "Aadhaar card");
  assert.deepEqual(K.KYM, [
    { id: "clear", label: "No block — OK to buy" },
    { id: "blacklisted", label: "Black-listed" },
    { id: "duplicate", label: "Duplicate IMEI" },
    { id: "in_use", label: "Already in use" },
  ]);
  assert.equal(K.HANDOVER_LABEL, "Owner confirmed · SIM out · IMEI matches · no EMI/lock");
  assert.deepEqual(K.CHECK_KEYS, ["ownership", "simRemoved", "imeiMatches", "noFinanceLock"]);
});

test("one hand-over confirm sends all four flags the server checks", () => {
  assert.deepEqual(K.handoverChecks(true), { ownership: true, simRemoved: true, imeiMatches: true, noFinanceLock: true });
  assert.deepEqual(K.handoverChecks(false), { ownership: false, simRemoved: false, imeiMatches: false, noFinanceLock: false });
  const b = K.lockBody(filled({ handover: true }), head());
  for (const k of K.CHECK_KEYS) assert.equal(b.checks[k], true, k);
  const off = K.lockBody(filled({ handover: false }), head());
  for (const k of K.CHECK_KEYS) assert.equal(off.checks[k], false, k);
});

test("emptyLockForm: name and mobile from the case, nothing ticked", () => {
  const f = K.emptyLockForm({ customerName: "Ravi", customerPhone: "9876543210" });
  assert.equal(f.name, "Ravi");
  assert.equal(f.phone, "9876543210");
  assert.equal(f.idType, "");
  assert.equal(f.kym, "");
  assert.equal(f.handover, false);
  assert.equal(f.storageSeen, false);
  assert.equal(f.imeiCheckAck, false);
  assert.equal(K.emptyLockForm({ customerName: null, customerPhone: null }).name, "");
});

test("emptyLockForm: the KYM answer recorded before the tests pre-fills the chip and its reference (IMEI first)", () => {
  const imei = "356789012345678";
  const f = K.emptyLockForm({ customerName: "Ravi", customerPhone: null, imei, kymEarly: { status: "clear", reference: "SMS 10:42" } });
  assert.equal(f.kym, "clear");
  assert.equal(f.kymRef, "SMS 10:42");
  // Still the advisor's to change, and still checked like any other answer: a flag stops the lock.
  const flagged = K.emptyLockForm({ customerName: "Ravi Kumar", customerPhone: "9876543210", imei, kymEarly: { status: "blacklisted", reference: null } });
  assert.deepEqual([flagged.kym, flagged.kymRef], ["blacklisted", ""]);
  assert.equal(K.lockProblem({ ...flagged, idType: "pan", idLast4: "1234", handover: true }, head()), "The register flags this phone — do not take it.");
  // No early answer, or no IMEI for it to be about: nothing pre-filled.
  assert.equal(K.emptyLockForm({ customerName: "Ravi", customerPhone: null, imei, kymEarly: null }).kym, "");
  assert.equal(K.emptyLockForm({ customerName: "Ravi", customerPhone: null, imei: null, kymEarly: { status: "clear", reference: "x" } }).kym, "");
  // Only the first read pre-fills: a new IMEI clears it like any other answer.
  assert.equal(K.afterImeiChange(f, { imei, imei2: null }, { imei: "356789012345670", imei2: null }).kym, "");
});

test("lockProblem: a filled form for a measured phone with its IMEI passes", () => {
  assert.equal(K.lockProblem(filled(), head()), null);
});

test("lockProblem: the desk's order and words, one problem at a time", () => {
  // Fix each problem in turn, starting from an empty form: the next one in the desk's order shows.
  const h = head({ variantSource: "customer", variant: "512GB", imeiCheck: "invalid", imei: "356789012345670" });
  let f = K.emptyLockForm({ customerName: "R", customerPhone: "12345" });
  const steps: [string, Partial<LockForm>][] = [
    ["Enter the customer's name.", { name: "Ravi" }],
    ["Enter a 10-digit Indian mobile number.", { phone: "+91 98765" }],
    ["Enter a 10-digit Indian mobile number.", { phone: "98765-43210" }],
    ["Choose the customer's ID document.", { idType: "pan" }],
    ["Enter the ID's last 4 characters.", { idLast4: "12-4" }],
    ["Enter the ID's last 4 characters.", { idLast4: "x9z1" }],
    ["Do the KYM check and record it.", { kym: "blacklisted" }],
    ["The register flags this phone — do not take it.", { kym: "clear" }],
    ["Tick the hand-over check.", { handover: true }],
    [STORAGE, { storageSeen: true }],
    [IMEI_ACK, { imeiCheckAck: true }],
  ];
  for (const [want, fix] of steps) {
    assert.equal(K.lockProblem(f, h), want);
    f = { ...f, ...fix };
  }
  assert.equal(K.lockProblem(f, h), null);
});

test("lockProblem: every flagged KYM result refuses the phone", () => {
  for (const kym of ["blacklisted", "duplicate", "in_use"] as const) {
    assert.equal(K.lockProblem(filled({ kym }), head()), "The register flags this phone — do not take it.");
  }
});

test("lockProblem: storageSeen only when the customer typed the storage", () => {
  for (const variantSource of ["measured", "catalogue", "advisor", null] as const) {
    assert.equal(K.lockProblem(filled(), head({ variantSource })), null, String(variantSource));
  }
  assert.equal(K.lockProblem(filled(), head({ variantSource: "customer", variant: "512GB" })), STORAGE);
  assert.equal(K.lockProblem(filled({ storageSeen: true }), head({ variantSource: "customer", variant: "512GB" })), null);
});

test("lockProblem: imeiCheckAck only when an IMEI fails its check digit", () => {
  assert.equal(K.lockProblem(filled(), head({ imeiCheck: "invalid" })), IMEI_ACK);
  assert.equal(K.lockProblem(filled(), head({ imeiCheck: "valid", imei2Check: "invalid" })), IMEI_ACK);
  assert.equal(K.lockProblem(filled({ imeiCheckAck: true }), head({ imeiCheck: "invalid" })), null);
  // Ticking it when nothing is wrong changes nothing.
  assert.equal(K.lockProblem(filled({ imeiCheckAck: true }), head()), null);
});

test("lockProblem: the IMEI comes last, in the server's words", () => {
  assert.equal(K.lockProblem(filled(), head({ imei: null, imeiCheck: null })), "Record the IMEI (dial *#06#).");
  assert.equal(K.IMEI_MISSING, "Record the IMEI (dial *#06#).");
});

test("lockProblem: with no IMEI yet, the KYM step asks for the IMEI — its chips can't be tapped until there is one", () => {
  assert.equal(K.lockProblem(filled({ kym: "" }), head({ imei: null, imeiCheck: null })), K.IMEI_MISSING);
  // The desk's earlier steps still come first.
  assert.equal(K.lockProblem(filled({ kym: "", idType: "" }), head({ imei: null, imeiCheck: null })), "Choose the customer's ID document.");
  // With the IMEI, the KYM step is the KYM.
  assert.equal(K.lockProblem(filled({ kym: "" }), head()), "Do the KYM check and record it.");
});

test("lockTicks: one hand-over confirm, then storage and the IMEI re-read only when needed", () => {
  assert.deepEqual(K.lockTicks(head()), [{ key: "handover", label: K.HANDOVER_LABEL, hint: K.HANDOVER_HINT }]);
  const all = K.lockTicks(head({ variantSource: "customer", variant: "512GB", imeiCheck: "invalid" }));
  assert.deepEqual(all.slice(1), [
    { key: "storageSeen", label: "Settings › About phone shows 512GB" },
    { key: "imeiCheckAck", label: "IMEI re-read on *#06#: correct" },
  ]);
});

test("lockBody: exactly the desk's payload — trimmed, digits only, last 4 uppercased", () => {
  assert.deepEqual(K.lockBody(filled(), head()), {
    customer: { name: "Ravi Kumar", phone: "9876543210", idType: "aadhaar", idLast4: "AB12" },
    checks: { ownership: true, simRemoved: true, imeiMatches: true, noFinanceLock: true, kym: { status: "clear", reference: "SMS 10:42" } },
  });
  // No reference: null, as the desk sends it.
  assert.equal(K.lockBody(filled({ kymRef: "   " }), head()).checks.kym.reference, null);
});

test("lockBody: imeiCheckAck and storageSeen ride along only when the server asks for them", () => {
  const b = K.lockBody(filled({ storageSeen: true, imeiCheckAck: true }), head({ variantSource: "customer", variant: "512GB", imeiCheck: "invalid" }));
  assert.equal(b.checks.storageSeen, true);
  assert.equal(b.checks.imeiCheckAck, true);
  const plain = K.lockBody(filled({ storageSeen: true, imeiCheckAck: true }), head());
  assert.equal("storageSeen" in plain.checks, false);
  assert.equal("imeiCheckAck" in plain.checks, false);
  // On the wire it is the desk's JSON.
  assert.equal(
    JSON.stringify(plain),
    '{"customer":{"name":"Ravi Kumar","phone":"9876543210","idType":"aadhaar","idLast4":"AB12"},"checks":{"ownership":true,"simRemoved":true,"imeiMatches":true,"noFinanceLock":true,"kym":{"status":"clear","reference":"SMS 10:42"}}}'
  );
});

test("serverBlocker: the first server blocker, skipping the IMEI one while the screen asks for the IMEI", () => {
  assert.equal(K.serverBlocker(head()), null);
  assert.equal(K.serverBlocker(head({ lockBlockers: ["Choose the new phone."] })), "Choose the new phone.");
  const noImei = head({ imei: null, imeiCheck: null, lockBlockers: ["Record the IMEI (dial *#06#).", "No trade-in price yet."] });
  assert.equal(K.serverBlocker(noImei), "No trade-in price yet.");
  assert.equal(K.serverBlocker({ ...noImei, lockBlockers: ["Record the IMEI (dial *#06#)."] }), null);
});

test("lockCaption: a server blocker first — the form can't fix it — then the form's first problem", () => {
  const empty = K.emptyLockForm({ customerName: "Ravi Kumar", customerPhone: null });
  assert.equal(K.lockCaption(empty, head()), "Enter a 10-digit Indian mobile number.");
  assert.equal(K.lockCaption(empty, head({ lockBlockers: ["Choose the new phone."] })), "Choose the new phone.");
  assert.equal(K.lockCaption(filled(), head({ lockBlockers: ["The trade-in price has expired — re-quote."] })), "The trade-in price has expired — re-quote.");
  assert.equal(K.lockCaption(filled(), head()), null, "nothing in the way");
  // The IMEI blocker waits while the screen asks for the IMEI itself; the form's own IMEI line says it.
  const noImei = head({ imei: null, imeiCheck: null, lockBlockers: [K.IMEI_MISSING] });
  assert.equal(K.lockCaption(filled({ kym: "" }), noImei), K.IMEI_MISSING);
  // A flagged phone: the red banner speaks, not the caption — even with a blocker.
  assert.equal(K.lockCaption(filled({ kym: "duplicate" }), head({ lockBlockers: ["Choose the new phone."] })), null);
});

test("kymText: the desk's words, with IMEI 2 when the case has one", () => {
  assert.equal(K.kymText({ imei: null, imei2: null }), "Record the IMEI first.");
  assert.equal(K.kymText({ imei: null, imei2: "356789012345686" }), "Record the IMEI first.");
  assert.equal(K.kymText({ imei: "356789012345678", imei2: null }), "SMS “KYM 356789012345678” to 14422 or use Sanchar Saathi.");
  assert.equal(
    K.kymText({ imei: "356789012345678", imei2: "356789012345686" }),
    "SMS “KYM 356789012345678” to 14422 (again for 356789012345686) or use Sanchar Saathi."
  );
});

test("kymSends: one SMS per IMEI, both off until IMEI 1 is recorded", () => {
  assert.deepEqual(K.kymSends({ imei: "356789012345678", imei2: null }), [{ title: "Text KYM to 14422", uri: "sms:14422?body=KYM%20356789012345678", disabled: false }]);
  assert.deepEqual(K.kymSends({ imei: "356789012345678", imei2: "356789012345686" }), [
    { title: "Text KYM to 14422", uri: "sms:14422?body=KYM%20356789012345678", disabled: false },
    { title: "Text KYM for IMEI 2", uri: "sms:14422?body=KYM%20356789012345686", disabled: false },
  ]);
  assert.deepEqual(
    K.kymSends({ imei: null, imei2: null }).map((b) => b.disabled),
    [true]
  );
  assert.deepEqual(
    K.kymSends({ imei: null, imei2: "356789012345686" }).map((b) => b.disabled),
    [true, true]
  );
});

test("kymOpen: the result chips only once there is an IMEI to check", () => {
  assert.equal(K.kymOpen({ imei: null }), false);
  assert.equal(K.kymOpen({ imei: "356789012345678" }), true);
});

test("afterImeiChange: a KYM answer and the IMEI ticks never carry over to a different number", () => {
  const ticked = filled({ kym: "clear", kymRef: "SMS 10:42", imeiCheckAck: true });
  const a = { imei: "356789012345678", imei2: "356789012345686" };
  // The first read, and a re-read with the same IMEIs: untouched (the same object).
  assert.equal(K.afterImeiChange(ticked, null, a), ticked);
  assert.equal(K.afterImeiChange(ticked, a, { ...a }), ticked);
  const cleared = (f: LockForm) => [f.kym, f.kymRef, f.handover, f.imeiCheckAck];
  // IMEI 1 recorded here, IMEI 1 or IMEI 2 edited on the desk, IMEI 2 removed.
  for (const now of [{ ...a, imei: "356789012345670" }, { ...a, imei2: "356789012345694" }, { ...a, imei2: null }]) {
    const f = K.afterImeiChange(ticked, a, now);
    assert.deepEqual(cleared(f), ["", "", false, false], JSON.stringify(now));
    // Everything else the advisor did stays.
    assert.equal(f.name, ticked.name);
    assert.equal(f.idLast4, ticked.idLast4);
    assert.equal(f.idType, ticked.idType);
  }
  assert.deepEqual(cleared(K.afterImeiChange(ticked, { imei: null, imei2: null }, a)), ["", "", false, false], "the IMEI was just recorded");
});

test("kymSmsUri: the Android sms: form with the IMEI", () => {
  assert.equal(K.kymSmsUri("356789012345678"), "sms:14422?body=KYM%20356789012345678");
  assert.equal(K.kymSmsUri(" 35678901 2345678 "), "sms:14422?body=KYM%20356789012345678");
  assert.equal(K.kymSmsUri(null), "sms:14422?body=KYM%20");
});

test("mobile: typed with +91, a leading 0, spaces or dashes — accepted as the same 10 digits (the server's rule)", () => {
  for (const typed of ["9876543210", "98765 43210", "+91 98765 43210", "91-98765-43210", "098765 43210", "+91 (987) 654-3210"]) {
    assert.equal(K.indianMobile(typed), "9876543210", typed);
    assert.equal(K.lockProblem(filled({ phone: typed }), head()), null, typed);
    assert.equal(K.lockBody(filled({ phone: typed }), head()).customer.phone, "9876543210", typed);
  }
  for (const bad of ["", "12345", "5876543210", "+1 98765 43210", "919876543210123"]) {
    assert.equal(K.indianMobile(bad), null, bad);
    assert.equal(K.lockProblem(filled({ phone: bad }), head()), "Enter a 10-digit Indian mobile number.", bad);
  }
});

test("lockProblemSpot: the line above the pill points at the card that needs attention", () => {
  assert.equal(K.lockProblemSpot(filled(), head()), null);
  assert.equal(K.lockProblemSpot(filled({ phone: "" }), head()), "customer");
  assert.equal(K.lockProblemSpot(filled({ name: "" }), head()), "customer");
  assert.equal(K.lockProblemSpot(filled({ idLast4: "" }), head()), "id");
  assert.equal(K.lockProblemSpot(filled({ kym: "" }), head()), "kym");
  assert.equal(K.lockProblemSpot(filled({ handover: false }), head()), "checks");
});
