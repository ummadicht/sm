// The phone-led flow's pure helpers (swapup docs/PHONE-LED-FLOW.md): Identify (IMEI
// paste, mobile, the server's identity, the model picker), the browser's step order, the
// phase the store hears about, and the battery screenshot. They live in src/check/ but
// are tested here so the repo's one test command (src/diagnostics/auto/*.test.ts) runs
// them. Same import trick as ./analysis.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const C: typeof import("../../check/core") = await import("../../check/core" + ".ts");
const B: typeof import("../../check/battery") = await import("../../check/battery" + ".ts");

type State = import("../../check/core").CheckState;

const IMEI_A = "356938035643809";
const IMEI_B = "356938035643817";

const plan = (...ids: string[]) => ids.map((id) => ({ id, name: id, critical: false }));

const state = (p: Partial<State> = {}): State => ({
  v: 1,
  server: "https://s",
  code: "K7M2QX",
  ticket: "t",
  session: { id: "s1", caseRef: "SU-1", storeName: "Andheri", plan: plan("touch", "display", "battery_health"), server: "https://s" },
  joinedAt: "2026-10-17T10:00:00Z",
  consentAt: "2026-10-17T10:00:01Z",
  declared: null,
  declaredSentAt: null,
  declaredAt: null,
  results: {},
  acked: {},
  completeAt: null,
  completeSentAt: null,
  ended: null,
  ...p,
});

test("identify: the IMEIs in pasted *#06# text", () => {
  assert.deepEqual(C.imeisFromText(`IMEI 1 ${IMEI_A} / 01`), [IMEI_A], "'IMEI 1' running into the number");
  assert.deepEqual(C.imeisFromText(`IMEI1: ${IMEI_A}/01\nIMEI2: ${IMEI_B}/01`), [IMEI_A, IMEI_B]);
  assert.deepEqual(C.imeisFromText(`${IMEI_A} ${IMEI_B}`), [IMEI_A, IMEI_B]);
  assert.deepEqual(C.imeisFromText(IMEI_A + IMEI_B), [IMEI_A, IMEI_B], "two written together, both check digits good");
  assert.deepEqual(C.imeisFromText("356938 03 564380 9"), [IMEI_A], "spaced groups joined when the check digit agrees");
  assert.deepEqual(C.imeisFromText(`${IMEI_A}\n${IMEI_A}`), [IMEI_A], "no repeats");
  assert.deepEqual(C.imeisFromText("3569380356438001"), [], "a 16-digit IMEISV is not an IMEI");
  assert.deepEqual(C.imeisFromText("123456789012345"), ["123456789012345"], "15 digits as written are kept — the pill shows the bad check digit");
  assert.deepEqual(C.imeisFromText("12345 67890 12345"), [], "a join that fails the check digit would be a guess");
  assert.deepEqual(C.imeisFromText(""), []);
  assert.equal(C.checkImei("123456789012345").ok, false);
});

test("identify: mobile and name are optional and tidied", () => {
  assert.deepEqual(C.cleanMobile(""), { ok: true, value: null });
  assert.deepEqual(C.cleanMobile("+91 98765-43210"), { ok: true, value: "9876543210" });
  assert.deepEqual(C.cleanMobile("09876543210"), { ok: true, value: "9876543210" });
  assert.equal(C.cleanMobile("12345").ok, false);
  assert.equal(C.cleanMobile("5876543210").ok, false, "Indian mobiles start 6–9");
  assert.equal(C.cleanName("   "), null);
  assert.equal(C.cleanName("  Asha   Rao "), "Asha Rao");
  assert.equal(C.cleanName("x".repeat(90))?.length, 60);
});

test("identify: the join response's identity — a match needs a name to confirm", () => {
  assert.equal(C.parseIdentity(undefined), null, "an older server sends none");
  assert.deepEqual(C.parseIdentity({ label: "Samsung Galaxy S23 Ultra", match: "exact", reason: "Model code SM-S918U is the Galaxy S23 Ultra.", variant: "256GB", modelId: "m1" }), {
    label: "Samsung Galaxy S23 Ultra",
    match: "exact",
    reason: "Model code SM-S918U is the Galaxy S23 Ultra.",
    variant: "256GB",
    modelId: "m1",
    variants: [],
  });
  assert.equal(C.parseIdentity({ label: "Samsung Galaxy S22", match: "family", why: "regional", variant: null, modelId: "m2" })?.reason, "regional", "matchModel's own `why`");
  const none = C.parseIdentity({ label: null, match: "none", reason: "Model code SM-X is not in SwapUp's model list.", variant: "128GB", modelId: "m3" });
  assert.equal(none?.match, "none");
  assert.equal(none?.variant, null);
  assert.equal(none?.modelId, null);
  assert.equal(C.parseIdentity({ match: "exact", modelId: "m1" })?.match, "none", "nothing to show → nothing to confirm");
  assert.equal(C.parseIdentity({ label: "X", match: "maybe" })?.match, "none");
  assert.equal(C.identityLine("Samsung Galaxy S23 Ultra", "256 GB"), "Samsung Galaxy S23 Ultra · 256 GB");
  assert.equal(C.identityLine("Samsung Galaxy S23 Ultra", null), "Samsung Galaxy S23 Ultra");
});

test("identify: a counter-code session asks for mobile + name", () => {
  assert.equal(C.startedByCustomer({ customerStarted: true }), true);
  assert.equal(C.startedByCustomer({ via: "counter code" }), true);
  assert.equal(C.startedByCustomer({ startedBy: "customer" }), true);
  assert.equal(C.startedByCustomer({ id: "s1" }), false);
  assert.equal(C.startedByCustomer({ customerStarted: "yes" }), false);
  assert.equal(C.startedByCustomer(null), false);
});

test("identify: the picker reads GET /api/device/models — brands, then a brand's models, no prices", () => {
  assert.deepEqual(C.parseBrands({ brands: ["Samsung", " Apple ", "Samsung", 4, ""] }), ["Samsung", "Apple"]);
  assert.equal(C.parseBrands({ models: [] }), null);
  assert.equal(C.parseBrands("<html>"), null);
  const ms = C.parseModels({
    models: [
      { id: "m1", brand: "Samsung", model: "Galaxy S23 Ultra", variants: ["256GB", "512GB", "256GB"], price: 99 },
      { id: "m1", brand: "Samsung", model: "dup" },
      { id: "", model: "x" },
      { id: "m2", model: "Galaxy A54" },
    ],
  });
  assert.deepEqual(ms, [
    { id: "m1", brand: "Samsung", model: "Galaxy S23 Ultra", variants: ["256GB", "512GB"] },
    { id: "m2", brand: "", model: "Galaxy A54", variants: [] },
  ]);
  assert.equal(C.parseModels({ brands: [] }), null);
  const list = ms ?? [];
  assert.deepEqual(C.filterModels(list, "s23 ul").map((m) => m.id), ["m1"], "every word typed, in any order of appearance");
  assert.deepEqual(C.filterModels(list, "  ").map((m) => m.id), ["m1", "m2"]);
  assert.deepEqual(C.filterModels(list, "pixel"), []);
});

test("steps: the browser order — welcome, Identify, Scan, battery, questions, tests, done", () => {
  const ids = ["touch", "display"];
  assert.equal(C.resumeStep(state({ consentAt: null }), ids), "welcome");
  assert.equal(C.resumeStep(state(), ids), "identify");
  const identified = { identifiedAt: "2026-10-17T10:01:00Z", declared: { screenCracked: null, backCracked: null, liquid: null, imei: IMEI_A, identityConfirmed: true, picked: null } };
  assert.equal(C.resumeStep(state(identified), ids), "scan", "Identify's own declaration doesn't answer the damage questions");
  const scanned = { ...identified, pairing: { outcome: "handoff" as const, at: "2026-10-17T10:04:00Z", reason: null } };
  assert.equal(C.resumeStep(state(scanned), ids), "battery");
  const battery = { ...scanned, battery: { outcome: "read" as const, healthPct: 87, at: "2026-10-17T10:05:00Z" } };
  assert.equal(C.resumeStep(state(battery), ids), "questions");
  const answered = { ...battery, declared: { ...identified.declared, screenCracked: false, backCracked: false, liquid: false } };
  assert.equal(C.resumeStep(state(answered), ids), "runner");
  const res = { outcome: "pass" as const, detail: null, at: "t" };
  assert.equal(C.resumeStep(state({ ...answered, results: { touch: res, display: res } }), ids), "done");
  // No battery_health in the plan (an older server): no battery step.
  assert.equal(C.resumeStep(state({ ...scanned, session: { ...state().session, plan: plan("touch", "display") } }), ids), "questions");
});

test("steps: a check begun before the Identify step carries on where it was", () => {
  const legacyAnswers = { screenCracked: false, backCracked: true, liquid: false, imei: null };
  const legacy = state({ declared: legacyAnswers, results: { touch: { outcome: "pass", detail: null, at: "t" } } });
  assert.equal(C.startedBeforeIdentify(legacy), true);
  assert.equal(C.resumeStep(legacy, ["touch", "display"]), "runner", "no jump back to Identify / Scan mid-run");
  // Only "can't run here" bookkeeping recorded so far is not a check under way.
  const fresh = state({ results: { voice: { outcome: "unsupported", detail: null, at: "t" } } });
  assert.equal(C.startedBeforeIdentify(fresh), false);
  assert.equal(C.resumeStep(fresh, ["touch"]), "identify");
  // A native check that finished its camera step under the old order.
  assert.equal(C.startedBeforeIdentify(state({ pairing: { outcome: "skipped", at: "t", reason: null } })), true);
  assert.equal(C.startedBeforeIdentify(state({ identifiedAt: "t", results: { touch: { outcome: "pass", detail: null, at: "t" } } })), false);
});

test("steps: the phase the store hears about", () => {
  assert.equal(C.phaseFor("welcome"), "identify");
  assert.equal(C.phaseFor("identify"), "identify");
  assert.equal(C.phaseFor("scan"), "scan");
  assert.equal(C.phaseFor("battery"), "battery");
  for (const s of ["questions", "runner", "auto", "actions"]) assert.equal(C.phaseFor(s), "test");
  assert.equal(C.phaseFor("done"), "done");
  assert.equal(C.wantsBatteryStep(plan("touch", "battery_health")), true);
  assert.equal(C.wantsBatteryStep(plan("touch", "battery")), false, "`battery` is the level test, not the screenshot");
});

test("battery: where the health % is, per phone", () => {
  const sam = B.batteryGuide({ brand: "samsung", modelCode: "SM-S918U" });
  assert.equal(sam.platform, "samsung");
  assert.match(sam.path, /Battery information/);
  assert.match(sam.alt ?? "", /Samsung Members/);
  assert.equal(B.batteryGuide({ modelCode: "SM-A546E" }).platform, "samsung", "the model code alone is enough");
  assert.equal(B.batteryGuide({ label: "Samsung Galaxy S22" }).platform, "samsung");
  assert.equal(B.batteryGuide({ brand: "google", modelCode: "Pixel 8" }).platform, "pixel");
  const other = B.batteryGuide({ brand: "OnePlus", modelCode: "CPH2449" });
  assert.equal(other.platform, "android");
  assert.ok(other.settingsAction);
  const ios = B.batteryGuide({ brand: "Apple", ios: true });
  assert.equal(ios.platform, "ios");
  assert.equal(ios.settingsAction, null, "no Android intent on an iPhone");
  assert.equal(B.batteryGuide({}).platform, "android");
});

test("battery: the screenshot is sent at most 1600 px on its longest side", () => {
  assert.deepEqual(B.fitWithin(1080, 2340), { height: 1600 });
  assert.deepEqual(B.fitWithin(2340, 1080), { width: 1600 });
  assert.equal(B.fitWithin(720, 1600), null, "already fits");
  assert.equal(B.fitWithin(0, 0), null, "size unknown — measured later");
  assert.deepEqual(B.fitWithin(3000, 3000, 1200), { width: 1200 });
});

test("battery: the store's answer, and the Result line", () => {
  assert.deepEqual(B.readBatteryAnswer({ healthPct: 87, outcome: "pass" }), { healthPct: 87, outcome: "pass" });
  assert.deepEqual(B.readBatteryAnswer({ healthPct: 72.4, outcome: "fail" }), { healthPct: 72, outcome: "fail" });
  assert.deepEqual(B.readBatteryAnswer({ healthPct: null, outcome: "skip" }), { healthPct: null, outcome: "skip" });
  assert.deepEqual(B.readBatteryAnswer({ healthPct: 0 }), { healthPct: null, outcome: "skip" }, "0 % is no reading");
  assert.deepEqual(B.readBatteryAnswer({ healthPct: 140 }), { healthPct: null, outcome: "skip" });
  assert.equal(B.readBatteryAnswer({ error: "nope" }), null);
  assert.equal(B.readBatteryAnswer(null), null);
  assert.equal(B.batteryResultText({ outcome: "read", healthPct: 87 }), "87 %");
  assert.equal(B.batteryResultText({ outcome: "unreadable", healthPct: null }), "couldn't be read");
  assert.equal(B.batteryResultText({ outcome: "skipped", healthPct: null }), "not checked");
  assert.equal(B.batteryResultText(null), "not checked");
});
