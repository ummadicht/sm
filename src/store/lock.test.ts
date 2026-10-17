// node --test --experimental-strip-types --no-warnings src/store/lock.test.ts
// TAKE THE TRADE-IN: the store app's form against the desk's (~/projects/swapup
// components/counter/LockForm.tsx) and the server's lockTradeIn. Same import trick as ./buySell.test.ts.
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
  checks: { ownership: true, simRemoved: true, imeiMatches: true, noFinanceLock: true },
  ...over,
});

const STORAGE = "Confirm before taking the phone: Settings › About phone shows 512GB (the customer typed it — the phone couldn't measure it).";
const IMEI_ACK = "An IMEI fails its check digit. Re-read it from *#06#, or confirm it is correct.";

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
  assert.deepEqual(
    K.CHECKS.map((c) => c.label),
    [
      "The customer confirms they own this phone",
      "SIM and memory card removed",
      "IMEI on the phone (*#06#) matches the one recorded",
      "Not on an EMI / finance plan, and no lender or company lock on it",
    ]
  );
});

test("emptyLockForm: name and mobile from the case, nothing ticked", () => {
  const f = K.emptyLockForm({ customerName: "Ravi", customerPhone: "9876543210" });
  assert.equal(f.name, "Ravi");
  assert.equal(f.phone, "9876543210");
  assert.equal(f.idType, "");
  assert.equal(f.kym, "");
  assert.deepEqual(f.checks, { ownership: false, simRemoved: false, imeiMatches: false, noFinanceLock: false });
  assert.equal(f.storageSeen, false);
  assert.equal(f.imeiCheckAck, false);
  assert.equal(K.emptyLockForm({ customerName: null, customerPhone: null }).name, "");
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
    ["Enter the last 4 characters of the ID number.", { idLast4: "12-4" }],
    ["Enter the last 4 characters of the ID number.", { idLast4: "x9z1" }],
    ["Do the government IMEI check (KYM) and record what it says.", { kym: "blacklisted" }],
    ["The government register flags this phone — do not take it.", { kym: "clear" }],
    ["Tick every hand-over check before taking the phone.", { checks: { ownership: true, simRemoved: true, imeiMatches: true, noFinanceLock: false } }],
    ["Tick every hand-over check before taking the phone.", { checks: { ownership: true, simRemoved: true, imeiMatches: true, noFinanceLock: true } }],
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
    assert.equal(K.lockProblem(filled({ kym }), head()), "The government register flags this phone — do not take it.");
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
  assert.equal(K.lockProblem(filled({ kym: "" }), head()), "Do the government IMEI check (KYM) and record what it says.");
});

test("lockTicks: the desk's four, then storage and the IMEI re-read only when needed", () => {
  assert.deepEqual(
    K.lockTicks(head()).map((t) => t.key),
    ["ownership", "simRemoved", "imeiMatches", "noFinanceLock"]
  );
  const all = K.lockTicks(head({ variantSource: "customer", variant: "512GB", imeiCheck: "invalid" }));
  assert.deepEqual(all.slice(4), [
    { key: "storageSeen", label: "Settings › About phone shows 512GB" },
    { key: "imeiCheckAck", label: "IMEI re-read from *#06# — it is correct" },
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
  const noImei = head({ imei: null, imeiCheck: null, lockBlockers: ["Record the IMEI (dial *#06#).", "This price comes from a SAMPLE rate card. Load the partner's rate card before taking a real trade-in."] });
  assert.equal(K.serverBlocker(noImei), "This price comes from a SAMPLE rate card. Load the partner's rate card before taking a real trade-in.");
  assert.equal(K.serverBlocker({ ...noImei, lockBlockers: ["Record the IMEI (dial *#06#)."] }), null);
});

test("lockCaption: a server blocker first — the form can't fix it — then the form's first problem", () => {
  const empty = K.emptyLockForm({ customerName: "Ravi Kumar", customerPhone: null });
  assert.equal(K.lockCaption(empty, head()), "Enter a 10-digit Indian mobile number.");
  assert.equal(K.lockCaption(empty, head({ lockBlockers: ["Choose the new phone."] })), "Choose the new phone.");
  assert.equal(K.lockCaption(filled(), head({ lockBlockers: ["The partner's quote has expired — re-quote."] })), "The partner's quote has expired — re-quote.");
  assert.equal(K.lockCaption(filled(), head()), null, "nothing in the way");
  // The IMEI blocker waits while the screen asks for the IMEI itself; the form's own IMEI line says it.
  const noImei = head({ imei: null, imeiCheck: null, lockBlockers: [K.IMEI_MISSING] });
  assert.equal(K.lockCaption(filled({ kym: "" }), noImei), K.IMEI_MISSING);
  // A flagged phone: the red banner speaks, not the caption — even with a blocker.
  assert.equal(K.lockCaption(filled({ kym: "duplicate" }), head({ lockBlockers: ["Choose the new phone."] })), null);
});

test("kymText: the desk's words, with IMEI 2 when the case has one", () => {
  assert.equal(K.kymText({ imei: null, imei2: null }), "Record the IMEI first: the check is an SMS of the IMEI to 14422.");
  assert.equal(K.kymText({ imei: null, imei2: "356789012345686" }), "Record the IMEI first: the check is an SMS of the IMEI to 14422.");
  assert.equal(K.kymText({ imei: "356789012345678", imei2: null }), "SMS “KYM 356789012345678” to 14422, or use the Sanchar Saathi app, and record the answer.");
  assert.equal(
    K.kymText({ imei: "356789012345678", imei2: "356789012345686" }),
    "SMS “KYM 356789012345678” to 14422 (and again for 356789012345686), or use the Sanchar Saathi app, and record the answer."
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
  const cleared = (f: LockForm) => [f.kym, f.kymRef, f.checks.imeiMatches, f.imeiCheckAck];
  // IMEI 1 recorded here, IMEI 1 or IMEI 2 edited on the desk, IMEI 2 removed.
  for (const now of [{ ...a, imei: "356789012345670" }, { ...a, imei2: "356789012345694" }, { ...a, imei2: null }]) {
    const f = K.afterImeiChange(ticked, a, now);
    assert.deepEqual(cleared(f), ["", "", false, false], JSON.stringify(now));
    // Everything else the advisor did stays.
    assert.equal(f.name, ticked.name);
    assert.equal(f.idLast4, ticked.idLast4);
    assert.deepEqual({ ...f.checks, imeiMatches: true }, ticked.checks);
  }
  assert.deepEqual(cleared(K.afterImeiChange(ticked, { imei: null, imei2: null }, a)), ["", "", false, false], "the IMEI was just recorded");
});

test("kymSmsUri: the Android sms: form with the IMEI", () => {
  assert.equal(K.kymSmsUri("356789012345678"), "sms:14422?body=KYM%20356789012345678");
  assert.equal(K.kymSmsUri(" 35678901 2345678 "), "sms:14422?body=KYM%20356789012345678");
  assert.equal(K.kymSmsUri(null), "sms:14422?body=KYM%20");
});
