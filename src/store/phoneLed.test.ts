// node --test --experimental-strip-types --no-warnings src/store/phoneLed.test.ts
// The phone-led flow as the store app reads it (docs/PHONE-LED-FLOW.md in the
// server repo): which layout a session gets, where the scan is, what the customer
// told their phone, battery health, the counter code. Same import trick as ./pin.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const F: typeof import("./phoneLed") = await import("./phoneLed" + ".ts");
const G: typeof import("./grading") = await import("./grading" + ".ts");

const dev = (appVersion: string) => ({ brand: "samsung", modelName: "SM-S918B", appVersion });

test("scanFirstApp: Check 0.6.0+, in the app or the browser", () => {
  for (const v of ["0.6.0", "0.6.3", "0.10.0", "1.0.0", "web-0.6.0", "web-1.2.3"]) assert.equal(F.scanFirstApp(v), true, v);
  for (const v of ["0.5.1", "0.3.0", "web-0.5.9", "", null, undefined, "dev", "6"]) assert.equal(F.scanFirstApp(v), false, String(v));
});

test("readPhonePhase: the key's presence says the server knows the flow; only known phases count", () => {
  assert.deepEqual(F.readPhonePhase({ id: "s", status: "waiting" }), { known: false, phase: null, at: null });
  assert.deepEqual(F.readPhonePhase({ phonePhase: null }), { known: true, phase: null, at: null });
  assert.deepEqual(F.readPhonePhase({ phonePhase: "scan", phonePhaseAt: "2026-10-17T10:00:00Z" }), { known: true, phase: "scan", at: "2026-10-17T10:00:00Z" });
  assert.equal(F.readPhonePhase({ phonePhase: "dancing" }).phase, null);
  assert.equal(F.readPhonePhase({ grading: { phonePhase: "battery" } }).phase, "battery");
});

test("sessionLayout: older servers and older phones keep their layouts", () => {
  const onePass = { state: "ready", cameraUrl: null, deviceReady: false };
  const twoPass = { state: "ready", photosUrl: "https://giq/v2/cam/x?pass=photos", screenUrl: null, photosDone: false, screenDone: false };
  const layout = (v: Record<string, unknown>) => F.sessionLayout(v, G.readGrading(v));

  // A server without the phone-led flow: exactly as before.
  assert.equal(layout({ status: "waiting", grading: onePass }), "onePass");
  assert.equal(layout({ status: "waiting", grading: twoPass }), "twoPass");
  assert.equal(layout({ status: "testing", device: dev("0.6.0"), grading: twoPass }), "twoPass", "an old server never gets the scan-first screen");

  // A server that knows it: before any phone joins, the phone-led order.
  assert.equal(layout({ status: "waiting", phonePhase: null, grading: twoPass }), "scanFirst");
  // An older app joins: the server keeps offering photos first, and so does the screen.
  assert.equal(layout({ status: "joined", phonePhase: null, device: dev("0.5.1"), grading: twoPass }), "twoPass");
  // A 0.6.0 phone: the server stops offering photos first.
  const scanGrading = { ...twoPass, photosUrl: null };
  assert.equal(layout({ status: "joined", phonePhase: null, device: dev("0.6.0"), grading: scanGrading }), "scanFirst");
  assert.equal(layout({ status: "joined", phonePhase: "identify", device: dev("web-0.6.0"), grading: scanGrading }), "scanFirst");
  // A phase posted is proof enough, whatever the version string says.
  assert.equal(layout({ status: "joined", phonePhase: "scan", device: dev("dev"), grading: scanGrading }), "scanFirst");
  // Camera grading off: no photosUrl either way — the phone still leads.
  assert.equal(layout({ status: "testing", phonePhase: "test", device: dev("0.6.0"), grading: { state: "disabled", photosUrl: null } }), "scanFirst");
  // The server still offers photos first for this phone: its call, not ours.
  assert.equal(layout({ status: "joined", phonePhase: null, device: dev("0.6.0"), grading: twoPass }), "twoPass");
});

test("scanStage: waiting → now → done, or skipped when the phone moved on without the camera", () => {
  const base = { grading: "ready" as const, phase: null, status: "joined", deviceReady: false, photosDone: false, screenDone: false };
  assert.equal(F.scanStage({ ...base, grading: "absent" }), "off");
  assert.equal(F.scanStage({ ...base, grading: "failed", phase: "scan" }), "off");
  assert.equal(F.scanStage({ ...base, grading: "pending", phase: "scan" }), "setup");
  assert.equal(F.scanStage({ ...base, status: "waiting" }), "waiting");
  assert.equal(F.scanStage({ ...base, phase: "identify" }), "waiting");
  assert.equal(F.scanStage({ ...base, phase: "scan" }), "now");
  assert.equal(F.scanStage({ ...base, deviceReady: true }), "now", "echoing without a phase post is the scan screen");
  assert.equal(F.scanStage({ ...base, phase: "scan", photosDone: true }), "now", "photos in, the screen sweep still to run");
  assert.equal(F.scanStage({ ...base, phase: "scan", screenDone: true }), "done");
  assert.equal(F.scanStage({ ...base, phase: "test", screenDone: true }), "done");
  assert.equal(F.scanStage({ ...base, phase: "battery", photosDone: true }), "done", "photos only — the LCD line says not camera-checked");
  assert.equal(F.scanStage({ ...base, phase: "battery" }), "skipped");
  assert.equal(F.scanStage({ ...base, status: "testing" }), "skipped", "results arrive only after the scan");
  assert.equal(F.scanStage({ ...base, status: "complete", phase: "done" }), "skipped");
});

test("scanFirstReached: Join · Identify · Scan · Test · Result", () => {
  assert.equal(F.scanFirstReached("waiting", null, false), 0);
  assert.equal(F.scanFirstReached("opened", null, false), 0);
  assert.equal(F.scanFirstReached("joined", null, true), 1);
  assert.equal(F.scanFirstReached("joined", "identify", true), 1);
  assert.equal(F.scanFirstReached("joined", "scan", true), 2);
  assert.equal(F.scanFirstReached("testing", "battery", true), 3);
  assert.equal(F.scanFirstReached("testing", null, true), 3);
  assert.equal(F.scanFirstReached("complete", "done", true), 4);
  assert.equal(F.scanFirstReached("applied", null, true), 4);
  assert.equal(F.scanFirstReached("expired", "scan", true), 2, "stopped where it was");
  assert.equal(F.scanFirstReached("expired", null, false), 0);
});

test("scanFirstNow: the top line follows the phone", () => {
  const v = (status: string) => ({ status, progress: { done: 3, total: 12 } });
  assert.match(F.scanFirstNow(v("joined"), "identify", "waiting")!.text, /identifying itself/);
  assert.match(F.scanFirstNow(v("joined"), "scan", "now")!.text, /showing its scan code.*Take photos/);
  assert.match(F.scanFirstNow(v("testing"), "test", "done")!.text, /^Testing itself — 3 of 12 done\. The camera grade is being worked out meanwhile\.$/);
  assert.match(F.scanFirstNow(v("testing"), "test", "skipped")!.text, /by eye/);
  assert.doesNotMatch(F.scanFirstNow(v("testing"), "test", "off")!.text, /camera grade/);
  assert.equal(F.scanFirstNow(v("complete"), "done", "done")!.tone, "up");
  assert.equal(F.scanFirstNow(v("applied"), "done", "done"), null, "the ordinary line says applied / expired / cancelled");
});

test("identity: what the customer told their phone, never guessed", () => {
  assert.deepEqual(F.readIdentity(null), { imei: null, imei2: null, identityConfirmed: null, picked: null, customerName: null, customerPhone: null });
  const id = F.readIdentity({
    screenCracked: null,
    imei: "490154203237518",
    imei2: " ",
    identityConfirmed: false,
    picked: { modelId: "galaxy-a54", variant: "128GB" },
    customerName: " Asha ",
    customerPhone: "9876543210",
  });
  assert.equal(id.imei, "490154203237518");
  assert.equal(id.imei2, null);
  assert.deepEqual(id.picked, { modelId: "galaxy-a54", variant: "128GB", label: null });
  assert.equal(id.customerName, "Asha");
  assert.equal(F.readIdentity({ picked: { variant: "128GB" } }).picked, null, "a pick without a model is no pick");

  assert.deepEqual(F.customerSays(id, "Samsung Galaxy A54", false), { text: "Not the model shown — they picked Samsung Galaxy A54 · 128GB", tone: "warn" });
  assert.equal(F.customerSays({ ...id, identityConfirmed: null }, null, false).text, "They picked galaxy-a54 · 128GB");
  assert.equal(F.customerSays({ ...id, picked: null, identityConfirmed: true }, null, false).tone, "up");
  assert.match(F.customerSays({ ...id, picked: null }, null, false).text, /left the model to you/);
  assert.equal(F.customerSays({ ...id, picked: null, identityConfirmed: null }, null, true).text, "Not answered yet");
});

test("readCaseImeis / modelLabels: the case's IMEIs and the catalogue's names", () => {
  assert.equal(F.readCaseImeis(null), null);
  assert.equal(F.readCaseImeis({ error: "Case not found." }), null);
  assert.deepEqual(F.readCaseImeis({ id: "c1", imei: "490154203237518", imei2: null }), { imei: "490154203237518", imei2: null });
  assert.deepEqual(F.readCaseImeis({ case: { imei: null, imei2: "352099001761481" } }), { imei: null, imei2: "352099001761481" });

  assert.deepEqual(
    F.modelLabels({ brands: ["Samsung"], models: [{ id: "galaxy-a54", brand: "Samsung", model: "Galaxy A54", variants: ["128GB"] }, { id: "x" }, { brand: "No id" }] }),
    { "galaxy-a54": "Samsung Galaxy A54" }
  );
  assert.deepEqual(F.modelLabels(null), {});
});

test("imeiCheck: the Luhn check digit", () => {
  assert.equal(F.imeiCheck("490154203237518"), "ok");
  assert.equal(F.imeiCheck("35-209900-176148-1"), "ok", "separators are ignored");
  assert.equal(F.imeiCheck("490154203237519"), "bad");
  assert.equal(F.imeiCheck("49015420323751"), "bad", "14 digits");
  assert.equal(F.imeiCheck(""), null);
  assert.equal(F.imeiCheck(null), null);
});

test("imeiMismatch: only when the typed numbers share none with the case", () => {
  const id = (imei: string | null, imei2: string | null = null) => ({ ...F.readIdentity(null), imei, imei2 });
  const onCase = (imei: string | null, imei2: string | null = null) => ({ imei, imei2 });
  assert.equal(F.imeiMismatch(id("490154203237518"), null), null, "no case to compare with");
  assert.equal(F.imeiMismatch(id("490154203237518"), onCase(null)), null, "nothing recorded on the case");
  assert.equal(F.imeiMismatch(id(null), onCase("490154203237518")), null, "nothing typed");
  assert.equal(F.imeiMismatch(id("490154203237518"), onCase("490154203237518")), null);
  assert.equal(F.imeiMismatch(id("352099001761481", "490154203237518"), onCase("490154203237518", "352099001761481")), null, "dual SIM typed in the other order");
  assert.deepEqual(F.imeiMismatch(id("352099001761481"), onCase("490154203237518")), { recorded: ["490154203237518"] });
});

test("batteryHealth: the screenshot's % and what it means", () => {
  assert.equal(F.batteryHealth({}), null);
  assert.equal(F.batteryHealth(null), null);
  const ok = F.batteryHealth({ battery_health: { outcome: "pass", detail: { healthPct: 87, method: "battery screenshot read by GradeIQ" } } })!;
  assert.deepEqual(ok, { pct: 87, outcome: "pass", method: "battery screenshot read by GradeIQ", earlier: [] });
  assert.deepEqual(F.batteryLine(ok), { text: "87%", tone: "up" });
  const low = F.batteryHealth({ battery_health: { outcome: "fail", detail: { healthPct: 72.4 } } })!;
  assert.deepEqual(F.batteryLine(low), { text: "72% — below 80%", tone: "bad" });
  const unread = F.batteryHealth({ battery_health: { outcome: "skip", detail: { healthPct: null } } })!;
  assert.equal(unread.pct, null);
  assert.equal(F.batteryLine(unread).tone, "muted");
  assert.equal(F.batteryHealth({ battery_health: { outcome: "fail", detail: { healthPct: 0 } } })!.pct, null, "0 % is unreadable, not a dead battery");
  // A seller who tried several screenshots: the earlier readings stay in view, and a pass is no longer plain green.
  const retried = F.batteryHealth({ battery_health: { outcome: "pass", detail: { healthPct: 91, earlier: [72, "x", 74] } } })!;
  assert.deepEqual(retried.earlier, [72, 74]);
  assert.deepEqual(F.batteryLine(retried), { text: "91% (earlier screenshots: 72%, 74%)", tone: "warn" });
});

test("server verdicts: imeiAgreement, customerStarted, scanFirst", () => {
  assert.equal(F.readImeiAgreement({ imeiAgreement: "differs" }), "differs");
  assert.equal(F.readImeiAgreement({ imeiAgreement: null }), null);
  assert.equal(F.readImeiAgreement({}), null);
  assert.equal(F.customerStarted({ customerStarted: true }), true);
  assert.equal(F.customerStarted({ customerStarted: "yes" }), false);
  // The server's own scanFirst counts as the phone leading, even before it posts a phase.
  const v = { status: "joined", phonePhase: null, scanFirst: true, device: { appVersion: "custom-build" }, grading: { state: "ready", photosUrl: null } };
  assert.equal(F.sessionLayout(v, G.readGrading(v)), "scanFirst");
});

test("scanFlag: Home asks for the advisor only when the phone is waiting to be scanned", () => {
  assert.deepEqual(F.scanFlag("now"), { text: "Ready to scan", tone: "fix" });
  for (const s of ["off", "setup", "waiting", "done", "skipped"] as const) assert.equal(F.scanFlag(s), null);
});

test("readCounterCode: the counter code answer", () => {
  assert.equal(F.readCounterCode(null), null);
  assert.equal(F.readCounterCode({ error: "nope" }), null);
  assert.deepEqual(F.readCounterCode({ code: "k7m2qx", joinUrl: "https://s/j/K7M2QX" }), { code: "K7M2QX", joinUrl: "https://s/j/K7M2QX" });
  assert.deepEqual(F.readCounterCode({ code: "K7M2QX" }), { code: "K7M2QX", joinUrl: null });
});
