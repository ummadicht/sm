// Pairing, plan partition and touch-grid verdicts. See analysis.test.ts for why the import looks like this.
import test from "node:test";
import assert from "node:assert/strict";

const P: typeof import("./pairing") = await import("./pairing" + ".ts");
const Plan: typeof import("./plan") = await import("./plan" + ".ts");
const Tch: typeof import("./touch") = await import("./touch" + ".ts");

const poll = (p: Partial<import("./pairing").ScreenPoll> = {}): import("./pairing").ScreenPoll => ({
  state: "ready",
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
  assert.deepEqual(s, { state: null, pattern: "white", shown: "idle", cosmeticDone: true, handoffDone: false, connectedAt: "2026-10-16T10:00:00Z", capture: { verdict: "retake", reasons: ["blur"] } });
  // SwapUp's actual shape (MOBILE-API §4): state + no connectedAt.
  const su = P.parseScreen({ state: "pending", pattern: "idle", shown: null, cosmeticDone: false, handoffDone: false, capture: null });
  assert.equal(su?.state, "pending");
  assert.equal(su?.connectedAt, null);
});

test("pairing: state disabled / failed → leave at once and run the tests; pending waits", () => {
  assert.equal(P.trackPoll(P.newTracker(0), poll({ state: "disabled" }), 500).leave, "disabled");
  assert.equal(P.trackPoll(P.newTracker(0), poll({ state: "failed" }), 500).leave, "failed");
  const r = P.trackPoll(P.newTracker(0), poll({ state: "pending" }), 500);
  assert.equal(r.leave, null);
  assert.equal(r.tracker.connectedAt, null);
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
  let tr = P.trackPoll(P.newTracker(0), poll({ connectedAt: "x" }), 500).tracker;
  tr = P.trackPoll(tr, poll({ connectedAt: "x", cosmeticDone: true }), 1000).tracker;
  assert.equal(tr.cosmeticSince, 1000);
  tr = P.trackPoll(tr, poll({ connectedAt: "x", capture: { verdict: "retake", reasons: [] } }), 20_000).tracker;
  assert.equal(tr.cosmeticSince, null);
  const r = P.trackPoll(tr, poll({ connectedAt: "x", cosmeticDone: true }), 40_000);
  assert.equal(r.leave, null);
  assert.equal(r.tracker.cosmeticSince, 40_000);
});

// Two camera passes (swapup docs/TWO-PASS-CAMERA.md, still served to older store flows): the
// photos are taken before the phone joins, so this screen can mount with pass 1's
// cosmeticDone + "ok" already on /screen.
const PASS1 = { cosmeticDone: true, capture: { verdict: "ok", reasons: [] }, connectedAt: "2026-10-17T09:00:00Z" };

test("pairing: pass 1's cosmeticDone already there at mount — not connected, no grace, the 90 s offer still comes", () => {
  let r = P.trackPoll(P.newTracker(0), poll(PASS1), 1000);
  assert.equal(r.leave, null);
  assert.equal(r.tracker.connectedAt, null, "an old cosmeticDone / capture is not the camera being here now");
  assert.equal(r.tracker.cosmeticSince, null, "and it must not start the 30 s grace");
  assert.deepEqual(P.freshNews(r.tracker, poll(PASS1)), { cosmeticDone: false, capture: null });
  // Well past the grace: still on the photo screen, waiting for the screen check.
  r = P.trackPoll(r.tracker, poll(PASS1), 1000 + P.GRACE_AFTER_COSMETIC_MS + 5000);
  assert.equal(r.leave, null);
  assert.equal(P.skipOffer(r.tracker, 89_999), null);
  assert.equal(P.skipOffer(r.tracker, 90_000), "never-connected");
  // Pass 2 opens: a NEW connectedAt, then the sweep's patterns, then handoffDone.
  r = P.trackPoll(r.tracker, poll({ ...PASS1, connectedAt: "2026-10-17T09:06:00Z" }), 50_000);
  assert.equal(r.tracker.connectedAt, 50_000);
  r = P.trackPoll(r.tracker, poll({ ...PASS1, connectedAt: "2026-10-17T09:06:00Z", pattern: "white" }), 52_000);
  assert.equal(r.leave, null, "pass 1's cosmeticDone never cuts the sweep short");
  r = P.trackPoll(r.tracker, poll({ ...PASS1, connectedAt: "2026-10-17T09:06:00Z", handoffDone: true }), 90_000);
  assert.equal(r.leave, "handoff");
});

test("pairing: the single pass (drives a colour, then cosmeticDone, no handoff) — grace as before", () => {
  let r = P.trackPoll(P.newTracker(0), poll(), 500);
  assert.equal(r.tracker.connectedAt, null);
  r = P.trackPoll(r.tracker, poll({ pattern: "white" }), 700);
  r = P.trackPoll(r.tracker, poll({ cosmeticDone: true }), 1000);
  assert.equal(r.tracker.connectedAt, 700);
  assert.equal(r.tracker.cosmeticSince, 1000);
  assert.equal(P.freshNews(r.tracker, poll({ cosmeticDone: true })).cosmeticDone, true);
  r = P.trackPoll(r.tracker, poll({ cosmeticDone: true }), 1000 + P.GRACE_AFTER_COSMETIC_MS - 1);
  assert.equal(r.leave, null);
  r = P.trackPoll(r.tracker, poll({ cosmeticDone: true }), 1000 + P.GRACE_AFTER_COSMETIC_MS);
  assert.equal(r.leave, "grace");
});

test("pairing: pass 1's leftovers become news only once they change", () => {
  // The capture verdict changes after mount (a retake judged now): that is the camera.
  let r = P.trackPoll(P.newTracker(0), poll(PASS1), 1000);
  r = P.trackPoll(r.tracker, poll({ ...PASS1, cosmeticDone: false, capture: { verdict: "retake", reasons: ["blur"] } }), 2000);
  assert.equal(r.tracker.connectedAt, 2000);
  assert.equal(P.freshNews(r.tracker, poll({ capture: { verdict: "retake", reasons: ["blur"] } })).capture?.verdict, "retake");
  // cosmeticDone cleared, then set again by a photos-only pass 1 that drives no colour:
  // news (the camera is here), but no grace — the screen check hasn't run.
  r = P.trackPoll(r.tracker, poll({ ...PASS1 }), 10_000);
  assert.equal(r.tracker.cosmeticSince, 10_000);
  assert.equal(P.trackPoll(r.tracker, poll(PASS1), 10_000 + P.GRACE_AFTER_COSMETIC_MS).leave, null);
});

test("pairing: a photos-only pass 1 that FINISHES after this screen mounted never walks the phone off", () => {
  let r = P.trackPoll(P.newTracker(0), poll(), 500); // mounted clean: pass 1 still running on the tablet
  r = P.trackPoll(r.tracker, poll({ cosmeticDone: true, capture: { verdict: "ok", reasons: [] } }), 20_000);
  assert.equal(r.tracker.sawPattern, false);
  r = P.trackPoll(r.tracker, poll({ cosmeticDone: true, capture: { verdict: "ok", reasons: [] } }), 20_000 + P.GRACE_AFTER_COSMETIC_MS + 60_000);
  assert.equal(r.leave, null, "waits for the screen check (pass 2) — its handoff, or the advisor skipping");
  r = P.trackPoll(r.tracker, poll({ cosmeticDone: true, pattern: "white" }), 200_000);
  r = P.trackPoll(r.tracker, poll({ cosmeticDone: true, handoffDone: true }), 230_000);
  assert.equal(r.leave, "handoff");
});

test("pairing: 'Finish without the screen check' only after 90 s with no store camera page", () => {
  let tr = P.newTracker(0);
  tr = P.trackPoll(tr, poll(), 1000).tracker;
  assert.equal(P.skipOffer(tr, 89_999), null);
  assert.equal(P.skipOffer(tr, 90_000), "never-connected");
  // A camera page opening while this screen is up (a NEW GradeIQ connectedAt) counts as connected…
  const before = P.trackPoll(P.newTracker(0), poll({ connectedAt: null }), 500).tracker;
  const opened = P.trackPoll(before, poll({ connectedAt: "2026-10-17T00:00:00Z" }), 1000).tracker;
  assert.equal(P.skipOffer(opened, 120_000), null);
  // …but a connectedAt already there when the screen mounted (a page opened earlier) does not.
  const stale = P.trackPoll(P.newTracker(0), poll({ connectedAt: "2026-10-16T23:00:00Z" }), 1000).tracker;
  assert.equal(stale.connectedAt, null);
  assert.equal(P.skipOffer(stale, 90_000), "never-connected");
  // A pattern left on screen for 90 s with nothing changing: the way out appears over it.
  const up = P.trackPoll(P.newTracker(0), poll({ pattern: "white" }), 1000).tracker;
  assert.equal(P.skipOffer(up, 1000 + P.PATTERN_STALL_MS - 1, true), null);
  assert.equal(P.skipOffer(up, 1000 + P.PATTERN_STALL_MS, true), "stalled");
  // Connected (a camera page opened after this screen mounted): no offer at 3 min…
  const c0 = P.trackPoll(P.newTracker(0), poll(), 500).tracker;
  const c = P.trackPoll(c0, poll({ connectedAt: "x" }), 1000).tracker;
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

// The phone-led flow (swapup docs/PHONE-LED-FLOW.md): Scan comes first and runs GradeIQ's
// single pass — photos (white on this screen), the colour sweep, then a photo of Settings
// (pattern back to idle, nothing said to this phone), then cosmeticDone + handoffDone.
test("scan: the Settings photo is asked for once the sweep is over and the screen is idle", () => {
  let r = P.trackPoll(P.newTracker(0), poll(), 500);
  // Idle at mount, before any sweep: that is the QR screen, not the Settings step.
  assert.equal(P.settingsPrompt(r.tracker, poll(), 500 + P.SETTINGS_PROMPT_AFTER_MS + 10_000), false);
  r = P.trackPoll(r.tracker, poll({ connectedAt: "x", pattern: "white" }), 20_000);
  assert.equal(r.tracker.idleSince, null);
  assert.equal(P.settingsPrompt(r.tracker, poll({ connectedAt: "x", pattern: "white" }), 20_000), false, "never over a pattern");
  for (const [i, p] of ["black", "red", "green", "blue", "stripes"].entries()) r = P.trackPoll(r.tracker, poll({ connectedAt: "x", pattern: p }), 30_000 + i * 2000);
  // The sweep ends: idle again, and the camera waits for the advisor's Settings photo.
  r = P.trackPoll(r.tracker, poll({ connectedAt: "x" }), 50_000);
  assert.equal(r.tracker.idleSince, 50_000);
  assert.equal(P.settingsPrompt(r.tracker, poll({ connectedAt: "x" }), 50_000 + P.SETTINGS_PROMPT_AFTER_MS - 1), false, "not for the second or two before the camera finishes");
  r = P.trackPoll(r.tracker, poll({ connectedAt: "x" }), 50_000 + P.SETTINGS_PROMPT_AFTER_MS);
  assert.equal(P.settingsPrompt(r.tracker, poll({ connectedAt: "x" }), 50_000 + P.SETTINGS_PROMPT_AFTER_MS), true);
  // A journey that grades straight away already has cosmeticDone here — still asked.
  assert.equal(P.settingsPrompt(r.tracker, poll({ connectedAt: "x", cosmeticDone: true }), 60_000), true);
  // A retake sends the advisor back to photographing the outside: no Settings prompt.
  assert.equal(P.settingsPrompt(r.tracker, poll({ connectedAt: "x", capture: { verdict: "retaking", reasons: [] } }), 60_000), false);
  // The camera finishes: handoffDone — leave, and no prompt.
  assert.equal(P.settingsPrompt(r.tracker, poll({ connectedAt: "x", handoffDone: true }), 61_000), false);
  assert.equal(P.trackPoll(r.tracker, poll({ connectedAt: "x", cosmeticDone: true, handoffDone: true }), 61_000).leave, "handoff");
});

test("scan: NO Settings prompt during the photos — white at the start, black for the front glass, idle for the sides", () => {
  // GradeIQ's single pass as it really runs: white when the photos start, black for the
  // front-glass shot, then idle while the back and four sides are photographed.
  let r = P.trackPoll(P.newTracker(0), poll(), 500);
  r = P.trackPoll(r.tracker, poll({ connectedAt: "x", pattern: "white" }), 10_000);
  r = P.trackPoll(r.tracker, poll({ connectedAt: "x", pattern: "black" }), 12_000);
  r = P.trackPoll(r.tracker, poll({ connectedAt: "x" }), 14_000);
  assert.equal(r.tracker.sawSweep, false);
  assert.equal(P.settingsPrompt(r.tracker, poll({ connectedAt: "x" }), 14_000 + 60_000), false, "the sides are being photographed — not Settings yet");
  // Only once the sweep's own colours have shown does an idle screen mean Settings.
  r = P.trackPoll(r.tracker, poll({ connectedAt: "x", pattern: "red" }), 80_000);
  r = P.trackPoll(r.tracker, poll({ connectedAt: "x" }), 90_000);
  assert.equal(P.settingsPrompt(r.tracker, poll({ connectedAt: "x" }), 90_000 + P.SETTINGS_PROMPT_AFTER_MS), true);
});

test("scan: the camera link is drawn only when it is a real http(s) URL", () => {
  assert.equal(P.parseCameraLink({ url: "https://swapmore.com/apps/gradeiq/v2/cam/9f1c" }), "https://swapmore.com/apps/gradeiq/v2/cam/9f1c");
  assert.equal(P.parseCameraLink({ url: "  http://localhost:3700/v2/cam/abc  " }), "http://localhost:3700/v2/cam/abc");
  assert.equal(P.parseCameraLink({ url: "javascript:alert(1)" }), null);
  assert.equal(P.parseCameraLink({ url: "https://" }), null);
  assert.equal(P.parseCameraLink({ url: "https://host/a b" }), null);
  assert.equal(P.parseCameraLink({ link: "https://host/x" }), null);
  assert.equal(P.parseCameraLink(null), null);
  assert.equal(P.parseCameraLink({ url: "https://h/" + "x".repeat(2100) }), null);
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

test("plan: battery_health is the server's (the screenshot step), never 'unsupported' on the phone", () => {
  const p = Plan.partitionPlan([...FULL, "battery_health"]);
  assert.deepEqual(p.server, ["display", "battery_health"]);
  assert.deepEqual(p.unknown, []);
  assert.ok(!p.auto.includes("battery_health"));
});

test("plan: speaker + mic are one loopback step", () => {
  assert.deepEqual(Plan.autoSteps(["mic", "battery", "speaker", "voice"]), ["battery", "loopback", "voice"]);
  assert.deepEqual(Plan.autoSteps(["mic"]), ["loopback"]);
});

test("plan: native step — Identify, Scan, battery, then the tests (auto, actions), then done", () => {
  const p = Plan.partitionPlan([...FULL, "battery_health"]);
  const at = (identified: boolean, scanned: boolean, battery: boolean) => ({ identified, scanned, battery });
  // A fresh check: the phone identifies itself first…
  assert.equal(Plan.nativeStep(at(false, false, false), {}, p), "identify");
  // …then shows its scan code (vision first)…
  assert.equal(Plan.nativeStep(at(true, false, false), {}, p), "scan");
  // …then the battery screenshot…
  assert.equal(Plan.nativeStep(at(true, true, false), {}, p), "battery");
  // …then tests itself.
  assert.equal(Plan.nativeStep(at(true, true, true), {}, p), "auto");
  const r: Record<string, { outcome: string }> = {};
  for (const id of [...p.auto, ...p.notInRun]) r[id] = { outcome: "pass" };
  assert.equal(Plan.nativeStep(at(true, true, true), r, p), "actions");
  r.touch = { outcome: "pass" };
  r.charging = { outcome: "skip" };
  // display and battery_health are never waited for: the server decides them.
  assert.equal(Plan.nativeStep(at(true, true, true), r, p), "done");
  assert.deepEqual(Plan.rerunnable(p, { ...r, mic: { outcome: "fail" }, multitouch: { outcome: "skip" } }), ["mic", "charging"]);
  // Resume-safe: every earlier step's record stands, whatever the results say.
  assert.equal(Plan.nativeStep(at(false, true, true), r, p), "identify");
  assert.equal(Plan.nativeStep(at(true, false, true), r, p), "scan");
});

test("plan: the runner may linger on its last tick only once the tests have started", () => {
  for (const s of ["auto", "actions", "done"] as const) assert.equal(Plan.testsStarted(s), true);
  for (const s of ["identify", "scan", "battery"] as const) assert.equal(Plan.testsStarted(s), false);
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
