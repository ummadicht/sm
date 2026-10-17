// node --test --experimental-strip-types --no-warnings src/store/grading.test.ts
// The two camera passes as the store app reads them (docs/TWO-PASS-CAMERA.md in the
// server repo), and "find by mobile". Same import trick as ./pin.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const G: typeof import("./grading") = await import("./grading" + ".ts");
const C: typeof import("./customers") = await import("./customers" + ".ts");

const session = (grading: unknown, status = "waiting") => ({ id: "s1", status, grading });

test("grading: an older server (one cameraUrl, no photosUrl) stays one-pass", () => {
  const g = G.readGrading(session({ state: "ready", deviceReady: true, cameraUrl: "https://giq/v2/cam/x", cosmeticDone: true }, "testing"));
  assert.equal(g.twoPass, false);
  assert.equal(g.cameraUrl, "https://giq/v2/cam/x");
  assert.equal(g.photosUrl, null);
  assert.equal(g.screenUrl, null);
  assert.equal(g.photosDone, true, "falls back to cosmeticDone");
  // Home: one pass still waits for the phone to join before photos are "needed".
  assert.equal(G.photosNeeded(session({ state: "ready", cameraUrl: null }), false), false);
});

test("grading: a two-pass server is two-pass even while photosUrl is still null", () => {
  const g = G.readGrading(session({ state: "pending", photosUrl: null, screenUrl: null, photosDone: false, screenDone: false, cameraUrl: null }));
  assert.equal(g.twoPass, true);
  assert.equal(g.phase, "pending");
  assert.equal(G.photosStep(g, false), "pending");
});

test("grading: photos at once, the screen check gated, both done flags read as sent", () => {
  const base = { state: "ready", photosUrl: "https://giq/v2/cam/x?pass=photos", screenUrl: null, cameraUrl: null, photosDone: false, screenDone: false, deviceReady: false };
  let g = G.readGrading(session(base));
  assert.equal(g.twoPass, true);
  assert.equal(g.photosUrl, "https://giq/v2/cam/x?pass=photos");
  assert.equal(g.screenUrl, null);
  assert.equal(G.photosStep(g, false), "todo");
  assert.equal(G.photosStep(g, true), "skipped");
  assert.equal(G.photosNeeded(session(base), false), true, "two passes: photos are due before the phone joins");

  g = G.readGrading(session({ ...base, photosDone: true, cosmeticDone: true }, "testing"));
  assert.equal(g.photosDone, true);
  assert.equal(G.photosStep(g, true), "done", "taken beats skipped");
  assert.equal(G.photosNeeded(session({ ...base, photosDone: true }), true), false);

  g = G.readGrading(session({ ...base, photosDone: true, deviceReady: true, screenUrl: "https://giq/v2/cam/x?pass=screen", screenDone: true }, "complete"));
  assert.equal(g.screenUrl, "https://giq/v2/cam/x?pass=screen");
  assert.equal(g.screenDone, true);
  // Camera grading off: step 1 says so instead of offering photos.
  assert.equal(G.photosStep(G.readGrading(session({ state: "disabled", photosUrl: null, photosDone: false })), false), "none");
});

test("customers: mobile numbers and the lookup answer", () => {
  assert.deepEqual(C.normaliseMobile("+91 98765-43210"), { ok: true, value: "9876543210" });
  assert.deepEqual(C.normaliseMobile(""), { ok: true, value: null });
  assert.deepEqual(C.normaliseMobile("12345"), { ok: false });

  assert.equal(C.readCustomerLookup(null), null);
  assert.equal(C.readCustomerLookup({ error: "nope" }), null);
  assert.deepEqual(C.readCustomerLookup({ customer: null, history: [] }), { customer: null, history: [] });

  const r = C.readCustomerLookup({
    customer: { name: " Asha Rao ", phone: "9876543210" },
    history: [
      { caseId: "c2", ref: "SU-AND-00012", status: "locked", storeName: "Andheri", device: "Galaxy S22", createdAt: "2026-10-12T10:00:00Z" },
      { caseId: "c1", ref: "SU-AND-00003", status: "walked_away", storeName: null, device: { brand: "Samsung", model: "Galaxy A52" }, createdAt: null },
      { ref: "no id" },
    ],
  });
  assert.equal(r?.customer?.name, "Asha Rao");
  assert.equal(r?.history.length, 2);
  assert.equal(r?.history[1].device, "Samsung Galaxy A52");
  assert.match(C.pastTradeInLine(r!.history[0]), /^SU-AND-00012 · Galaxy S22 · Traded in · at store · 12 Oct 2026 · Andheri$/);
  assert.equal(C.pastTradeInLine(r!.history[1]), "SU-AND-00003 · Samsung Galaxy A52 · Walked away");
});
