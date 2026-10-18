// node --test --experimental-strip-types --no-warnings src/store/phoneLed.test.ts
// The phone-led flow as the store app reads it (docs/PHONE-LED-FLOW.md in the
// server repo): which layout a session gets, where the scan is, the top line, the IMEI
// check digit, the counter code. Same import trick as ./pin.test.ts.
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

test("scanFirstNow: the top line follows the phone", () => {
  const v = (status: string) => ({ status, progress: { done: 3, total: 12 } });
  assert.match(F.scanFirstNow(v("joined"), "identify", "waiting")!.text, /Confirming which phone it is/);
  assert.match(F.scanFirstNow(v("joined"), "scan", "now")!.text, /Scan the code on the phone.*Take photos/);
  assert.match(F.scanFirstNow(v("testing"), "test", "done")!.text, /^Testing — 3 of 12 done; camera grade coming\.$/);
  assert.match(F.scanFirstNow(v("testing"), "test", "skipped")!.text, /not scanned, check the phone at step 3/);
  assert.doesNotMatch(F.scanFirstNow(v("testing"), "test", "off")!.text, /camera grade/);
  assert.equal(F.scanFirstNow(v("complete"), "done", "done")!.tone, "up");
  assert.equal(F.scanFirstNow(v("applied"), "done", "done"), null, "the ordinary line says applied / expired / cancelled");
});

test("imeiCheck: the Luhn check digit", () => {
  assert.equal(F.imeiCheck("490154203237518"), "ok");
  assert.equal(F.imeiCheck("35-209900-176148-1"), "ok", "separators are ignored");
  assert.equal(F.imeiCheck("490154203237519"), "bad");
  assert.equal(F.imeiCheck("49015420323751"), "bad", "14 digits");
  assert.equal(F.imeiCheck(""), null);
  assert.equal(F.imeiCheck(null), null);
});

test("server verdicts: customerStarted, scanFirst", () => {
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

test("colours: the phone showing the test colours is past its scan, and the session at its result", () => {
  assert.equal(F.readPhonePhase({ phonePhase: "colours" }).phase, "colours");
  const base = { grading: "ready" as const, status: "complete", deviceReady: false, photosDone: true, screenDone: false };
  assert.equal(F.scanStage({ ...base, phase: "colours" }), "done");
  assert.equal(F.scanFirstNow({ status: "testing" }, "colours", "done")?.text, "Tests done.");
});

test("screenUnchecked: a scan behind the phone whose screen the camera didn't check says so", () => {
  assert.equal(F.screenUnchecked("done", { screenDone: true, lcdNotChecked: null }), false, "photos and the sweep done");
  assert.equal(F.screenUnchecked("done", { screenDone: true, lcdNotChecked: "the camera never got a clear view of the lit screen" }), true, "the sweep ran without a verdict");
  assert.equal(F.screenUnchecked("done", { screenDone: false, lcdNotChecked: null }), true, "the phone moved on before the sweep");
  assert.equal(F.screenUnchecked("skipped", { screenDone: false, lcdNotChecked: null }), true);
  assert.equal(F.screenUnchecked("now", { screenDone: false, lcdNotChecked: null }), false, "still to come");
});

test("release: the advisor lets a waiting phone go on — offered only when the server says so, never twice", () => {
  assert.equal(G.readGrading({ grading: { state: "ready" } }).canRelease, false, "an older server");
  assert.equal(G.readGrading({ grading: { state: "ready", canRelease: true } }).canRelease, true);
  const done = G.readGrading({ grading: { state: "ready", canRelease: true, released: { by: "Asha K.", at: "2026-10-17T08:30:00Z" } } });
  assert.deepEqual(done.released, { by: "Asha K.", at: "2026-10-17T08:30:00Z" });
  assert.equal(done.canRelease, false);
  assert.deepEqual(G.readGrading({ grading: { state: "ready", released: true } }).released, { by: null, at: null });
  assert.equal(G.readGrading({ grading: { state: "ready", released: "yes" } }).released, null, "fail closed");
});
