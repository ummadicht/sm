// Pairing, plan partition and touch-grid verdicts. See analysis.test.ts for why the import looks like this.
import test from "node:test";
import assert from "node:assert/strict";

const P: typeof import("./pairing") = await import("./pairing" + ".ts");
const Plan: typeof import("./plan") = await import("./plan" + ".ts");
const Tch: typeof import("./touch") = await import("./touch" + ".ts");

const poll = (p: Partial<import("./pairing").ScreenPoll> = {}): import("./pairing").ScreenPoll => ({
  pattern: "idle",
  shown: null,
  cosmeticDone: false,
  handoffDone: false,
  connectedAt: null,
  capture: null,
  ...p,
});

test("pairing: patterns this phone can draw (GradeIQ names) — anything else is idle", () => {
  for (const p of ["white", "gray", "black", "red", "green", "blue", "stripes"]) assert.equal(P.displayablePattern(p), p);
  assert.equal(P.displayablePattern("WHITE "), "white");
  assert.equal(P.displayablePattern("magenta"), "idle");
  assert.equal(P.displayablePattern(undefined), "idle");
  assert.equal(P.displayablePattern("constructor"), "idle");
});

test("pairing: parse the proxied /screen body", () => {
  assert.equal(P.parseScreen(null), null);
  assert.equal(P.parseScreen({ error: "nope" }), null);
  const s = P.parseScreen({ pattern: "white", shown: "idle", cosmeticDone: true, handoffDone: "yes", capture: { verdict: "retake", reasons: ["blur", 3] }, connectedAt: "2026-10-16T10:00:00Z", model: "x" });
  assert.deepEqual(s, { pattern: "white", shown: "idle", cosmeticDone: true, handoffDone: false, connectedAt: "2026-10-16T10:00:00Z", capture: { verdict: "retake", reasons: ["blur"] } });
});

test("pairing: leave on handoffDone at once", () => {
  const t0 = P.newTracker(0);
  const r = P.trackPoll(t0, poll({ handoffDone: true, cosmeticDone: true }), 1000);
  assert.equal(r.leave, "handoff");
});

test("pairing: leave 30 s after cosmeticDone when handoffDone never comes (V2Flow grace)", () => {
  let tr = P.newTracker(0);
  tr = P.trackPoll(tr, poll({ connectedAt: "x", pattern: "white" }), 1000).tracker;
  let r = P.trackPoll(tr, poll({ connectedAt: "x", cosmeticDone: true }), 5000);
  assert.equal(r.leave, null);
  r = P.trackPoll(r.tracker, poll({ connectedAt: "x", cosmeticDone: true }), 5000 + 29_000);
  assert.equal(r.leave, null);
  r = P.trackPoll(r.tracker, poll({ connectedAt: "x", cosmeticDone: true }), 5000 + 30_000);
  assert.equal(r.leave, "grace");
});

test("pairing: a retake clears cosmeticDone, so the grace clock restarts", () => {
  let tr = P.trackPoll(P.newTracker(0), poll({ connectedAt: "x", cosmeticDone: true }), 1000).tracker;
  tr = P.trackPoll(tr, poll({ connectedAt: "x", capture: { verdict: "retake", reasons: [] } }), 20_000).tracker;
  assert.equal(tr.cosmeticSince, null);
  const r = P.trackPoll(tr, poll({ connectedAt: "x", cosmeticDone: true }), 40_000);
  assert.equal(r.leave, null);
  assert.equal(r.tracker.cosmeticSince, 40_000);
});

test("pairing: 'Continue without photos' only after 3 min with no store connection", () => {
  let tr = P.newTracker(0);
  tr = P.trackPoll(tr, poll(), 1000).tracker;
  assert.equal(P.skipOffer(tr, 179_999), null);
  assert.equal(P.skipOffer(tr, 180_000), "never-connected");
  // Connected: no offer at 3 min…
  const c = P.trackPoll(P.newTracker(0), poll({ connectedAt: "x" }), 1000).tracker;
  assert.equal(P.skipOffer(c, 200_000), null);
  // …only when nothing has changed for the long stall window.
  assert.equal(P.skipOffer(c, 1000 + P.STALL_MS), "stalled");
  // A pattern counts as connected even if connectedAt was not relayed.
  assert.notEqual(P.trackPoll(P.newTracker(0), poll({ pattern: "black" }), 10).tracker.connectedAt, null);
});

test("pairing: refused for 15 s straight → unavailable; a good poll resets it", () => {
  let tr = P.newTracker(0);
  let r = P.trackRefusal(tr, 1000);
  r = P.trackRefusal(r.tracker, 1700);
  r = P.trackRefusal(r.tracker, 2400);
  assert.equal(r.unavailable, false, "three quick refusals are not enough");
  r = P.trackRefusal(r.tracker, 1000 + P.UNAVAILABLE_AFTER_MS);
  assert.equal(r.unavailable, true);
  tr = P.trackPoll(r.tracker, poll(), 20_000).tracker;
  assert.equal(tr.refusals, 0);
  assert.equal(tr.refusingSince, null);
  assert.equal(P.trackRefusal(tr, 20_700).unavailable, false);
});

test("pairing: re-echo when the server's `shown` differs from what is drawn", () => {
  assert.equal(P.needsEcho(null, "idle"), true);
  assert.equal(P.needsEcho(poll({ shown: "white" }), "white"), false);
  assert.equal(P.needsEcho(poll({ shown: "idle" }), "white"), true);
});

const FULL = ["touch", "multitouch", "display", "motion", "mic", "speaker", "voice", "camera", "flash", "faceid", "vibration", "buttons", "battery", "charging", "connectivity", "sensors", "bluetooth", "nfc"];

test("plan: the 18 ids split into auto / actions / not-in-run / server", () => {
  const p = Plan.partitionPlan(FULL);
  assert.deepEqual(p.auto, ["battery", "sensors", "motion", "connectivity", "vibration", "speaker", "mic", "voice", "flash", "camera", "faceid", "bluetooth", "nfc"]);
  assert.deepEqual(p.actions, ["touch", "charging"]);
  assert.deepEqual(p.notInRun, ["multitouch", "buttons"]);
  assert.deepEqual(p.server, ["display"]);
  assert.deepEqual(p.unknown, []);
  assert.deepEqual(Plan.partitionPlan([...FULL, "thermal"]).unknown, ["thermal"]);
});

test("plan: speaker + mic are one loopback step", () => {
  assert.deepEqual(Plan.autoSteps(["mic", "battery", "speaker", "voice"]), ["battery", "loopback", "voice"]);
  assert.deepEqual(Plan.autoSteps(["mic"]), ["loopback"]);
});

test("plan: native step — pairing, auto, actions, done; display is never waited for", () => {
  const p = Plan.partitionPlan(FULL);
  assert.equal(Plan.nativeStep(false, {}, p), "pairing");
  assert.equal(Plan.nativeStep(true, {}, p), "auto");
  const r: Record<string, { outcome: string }> = {};
  for (const id of [...p.auto, ...p.notInRun]) r[id] = { outcome: "pass" };
  assert.equal(Plan.nativeStep(true, r, p), "actions");
  r.touch = { outcome: "pass" };
  r.charging = { outcome: "skip" };
  assert.equal(Plan.nativeStep(true, r, p), "done");
  assert.deepEqual(Plan.rerunnable(p, { ...r, mic: { outcome: "fail" }, multitouch: { outcome: "skip" } }), ["mic", "charging"]);
});

test("touch: clearing every square passes", () => {
  let st = Tch.newTouchState(0);
  const all = Array.from({ length: Tch.CELLS }, (_, i) => i);
  st = Tch.applyTouches(st, all, 5000);
  const v = Tch.touchVerdict(st, 5000);
  assert.equal(v?.outcome, "pass");
  assert.equal(v?.detail.cleared, Tch.CELLS);
});

test("touch: cell mapping", () => {
  assert.equal(Tch.cellAt(0, 0, 600, 1000), 0);
  assert.equal(Tch.cellAt(599, 999, 600, 1000), Tch.CELLS - 1);
  assert.equal(Tch.cellAt(600, 10, 600, 1000), null);
  assert.equal(Tch.cellAt(10, 10, 0, 0), null);
});

test("touch: a dead column with the finger reaching it repeatedly fails with the cells", () => {
  const deadCol = 3;
  const live = Array.from({ length: Tch.CELLS }, (_, i) => i).filter((i) => i % Tch.COLS !== deadCol);
  let st = Tch.applyTouches(Tch.newTouchState(0), live, 4000);
  assert.equal(Tch.touchVerdict(st, 4000), null);
  // The finger keeps sliding across the strip: it lands on its neighbours (columns 2 and 4).
  const neighbours = live.filter((i) => Math.abs((i % Tch.COLS) - deadCol) === 1);
  for (let k = 0; k < 3; k++) st = Tch.applyTouches(st, neighbours, 6000 + k * 1000);
  assert.ok(st.nearMisses >= Tch.DEAD_MIN_NEAR_MISSES);
  assert.equal(Tch.touchVerdict(st, 4000 + Tch.DEAD_AFTER_MS - 1), null);
  const v = Tch.touchVerdict(st, 4000 + Tch.DEAD_AFTER_MS);
  assert.equal(v?.outcome, "fail");
  assert.equal(String(v?.detail.deadCells).split(",").length, Tch.ROWS);
});

test("touch: stopping is untested, never failed", () => {
  const st = Tch.applyTouches(Tch.newTouchState(0), [0, 1, 2, 3], 1000);
  assert.equal(Tch.touchVerdict(st, 1000 + Tch.IDLE_GIVE_UP_MS - 1), null);
  const v = Tch.touchVerdict(st, 1000 + Tch.IDLE_GIVE_UP_MS);
  assert.equal(v?.outcome, "skip");
  assert.equal(Tch.touchVerdict(Tch.newTouchState(0), Tch.IDLE_GIVE_UP_MS)?.detail.reason, "the grid was not touched");
  // Most of the grid uncleared + lots of touches still isn't dead-region evidence.
  let busy = Tch.applyTouches(Tch.newTouchState(0), [0, 1, 2, 6, 7, 8], 1000);
  for (let k = 0; k < 40; k++) busy = Tch.applyTouches(busy, [1, 7], 2000 + k * 500);
  assert.notEqual(Tch.touchVerdict(busy, 30_000)?.outcome, "fail");
});
