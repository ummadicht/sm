// node --test --experimental-strip-types --no-warnings src/store/flow.test.ts
// The reduced store flow: the answer by itself (no "Apply to case" on the way), "Check the
// phone" inside the camera step only when the camera can't decide, and the top line. Same
// import trick as ./pin.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const F: typeof import("./flow") = await import("./flow" + ".ts");
const C: typeof import("./certify") = await import("./certify" + ".ts");
type CertifyView = import("./certify").CertifyView;

const card = (needed: string[], rows: Record<string, unknown> = {}, colours: string | null = "waiting", canEdit = true): CertifyView =>
  C.readCertify({ certify: { needed, rows, colours, canEdit } })!;
const tapped = { value: "ok", label: "OK", by: "Rahul Desai", at: "2026-10-17T10:00:00.000Z", withColours: true };

test("readAutoApply: the server's word on the answer, or null for an older server", () => {
  assert.equal(F.readAutoApply({}), null);
  assert.equal(F.readAutoApply({ autoApply: null }), null);
  assert.equal(F.readAutoApply({ autoApply: { state: "weird" } }), null);
  assert.deepEqual(F.readAutoApply({ autoApply: { state: "applied" } }), { state: "applied" });
  assert.deepEqual(F.readAutoApply({ autoApply: { state: "ready" } }), { state: "ready" });
  assert.deepEqual(F.readAutoApply({ autoApply: { state: "waiting", for: "certify", text: "Check the phone." } }), { state: "waiting", for: "certify", text: "Check the phone." });
  assert.deepEqual(F.readAutoApply({ autoApply: { state: "waiting", for: "???" } }), { state: "waiting", for: "tests", text: "" });
  assert.deepEqual(F.readAutoApply({ autoApply: { state: "refused", reason: " The case is past the counter. " } }), { state: "refused", reason: "The case is past the counter." });
});

test("the answer is reached with no Apply tap: step 4 never asks for one while the server leads", () => {
  for (const a of [{ state: "ready" }, { state: "waiting", for: "camera", text: "" }, { state: "waiting", for: "certify", text: "" }] as const) {
    assert.doesNotMatch(F.answerStepText("complete", a), /^Put the results on the case/, JSON.stringify(a));
  }
  assert.match(F.answerStepText("complete", { state: "waiting", for: "certify", text: "" }), /after your last tap/);
  assert.equal(F.answerStepText("complete", { state: "refused", reason: "The case is past the counter." }), "The case is past the counter.", "the one-line reason, as the server said it");
  // An older server: the button is the only way.
  assert.match(F.answerStepText("complete", null), /^Put the results on the case/);
});

test("Check the phone: only when the camera couldn't decide the screen or the body", () => {
  assert.equal(F.cameraUndecided(card(["screen", "body", "liquid"])), true);
  assert.equal(F.cameraUndecided(card(["screen", "liquid"])), true);
  assert.equal(F.cameraUndecided(card([])), false, "the camera decided it all");
  assert.equal(F.cameraUndecided(card(["liquid"])), false, "an older server's lone liquid row is no card");
  assert.equal(F.cameraUndecided(null), false);
});

test("…inside the camera step, once the camera is over and its grade isn't still coming", () => {
  const open = card(["screen", "body", "liquid"]);
  assert.equal(F.certifyInCamera(open, { cameraOver: true, gradePending: false }), true);
  assert.equal(F.certifyInCamera(open, { cameraOver: false, gradePending: false }), false, "still scanning: the camera may decide");
  assert.equal(F.certifyInCamera(open, { cameraOver: true, gradePending: true }), false, "the grade is coming");
  assert.equal(F.certifyInCamera(card(["liquid"]), { cameraOver: true, gradePending: false }), false);
});

test("cameraOver: scanned, gone on without it, camera off — or an older phone that has finished", () => {
  const base = { layout: "scanFirst" as const, stage: "now" as const, status: "joined", cameraOff: false, photosDone: false, screenDone: false };
  assert.equal(F.cameraOver(base), false);
  for (const stage of ["done", "skipped", "off"] as const) assert.equal(F.cameraOver({ ...base, stage }), true, stage);
  assert.equal(F.cameraOver({ ...base, status: "complete" }), true);
  assert.equal(F.cameraOver({ ...base, cameraOff: true }), true);
  // An older Check: tests first, photos last.
  const old = { ...base, layout: "onePass" as const, stage: "off" as const, status: "testing" };
  assert.equal(F.cameraOver(old), false);
  assert.equal(F.cameraOver({ ...old, photosDone: true, screenDone: true }), true);
});

test("on the answer the card shows only while a row is still open (the results went on before the taps)", () => {
  assert.equal(F.certifyStillOpen(card(["screen", "body", "liquid"])), true);
  assert.equal(F.certifyStillOpen(card(["screen", "body", "liquid"], { screen: tapped, body: tapped, liquid: tapped })), false, "all tapped in step 3: no second card");
  assert.equal(F.certifyStillOpen(card(["screen", "body", "liquid"], {}, null, false)), false, "past the counter");
  assert.equal(F.certifyStillOpen(card(["liquid"])), false);
});

test("on the answer, a fully tapped card stays one tap away while the case is at the counter — a wrong last tap can be put right", () => {
  assert.equal(F.answerCertifyMode(card(["screen", "body", "liquid"])), "open");
  const all = card(["screen", "body", "liquid"], { screen: tapped, body: tapped, liquid: tapped });
  assert.equal(F.answerCertifyMode(all), "change");
  assert.match(F.checkedByLine(all), /^Checked by .+ · change$/);
  assert.equal(F.answerCertifyMode(card(["screen", "body", "liquid"], { screen: tapped, body: tapped, liquid: tapped }, null, false)), null, "past the counter");
  assert.equal(F.answerCertifyMode(card(["liquid"])), null);
  assert.equal(F.answerCertifyMode(null), null);
});

test("the Screen row waits while the phone is still testing and will show the colours", () => {
  const waiting = { ...card(["screen", "body", "liquid"]), colours: "waiting" as const };
  assert.equal(F.holdScreen(waiting, "testing"), true);
  assert.equal(F.holdScreen(waiting, "complete"), false, "tests done: tap away (the colours are a poll away)");
  assert.equal(F.holdScreen({ ...waiting, colours: "showing" as const }, "testing"), false);
  assert.equal(F.holdScreen({ ...waiting, colours: "old_app" as const }, "testing"), false);
});

test("activeStep: connect, then the camera when it needs the advisor, then the answer", () => {
  assert.equal(F.activeStep({ status: "waiting", cameraNow: false, autoApply: null }), "connect");
  assert.equal(F.activeStep({ status: "joined", cameraNow: true, autoApply: null }), "camera");
  assert.equal(F.activeStep({ status: "testing", cameraNow: false, autoApply: null }), null, "the phone is testing itself");
  assert.equal(F.activeStep({ status: "complete", cameraNow: false, autoApply: { state: "waiting", for: "certify", text: "" } }), "camera", "the card is in the camera step");
  assert.equal(F.activeStep({ status: "complete", cameraNow: false, autoApply: { state: "ready" } }), "answer");
  assert.equal(F.activeStep({ status: "complete", cameraNow: false, autoApply: { state: "refused", reason: "x" } }), "answer");
  assert.equal(F.activeStep({ status: "applied", cameraNow: false, autoApply: { state: "applied" } }), "answer");
});

test("sessionNow: one sentence — the advisor is sent to the step that needs them, never to an Apply button", () => {
  const base = { status: "complete", caseRef: "SU-AND-00140", progress: { done: 12, total: 12 }, joinedAt: "2026-10-17T10:00:00.000Z", layout: "scanFirst" as const, phase: "done" as const, certify: null, certifyShown: false, phoneLine: null };
  assert.equal(F.sessionNow({ ...base, autoApply: { state: "waiting", for: "certify", text: "" } }).text, "Tests done — check the phone (step 3).");
  assert.match(F.sessionNow({ ...base, phase: "colours", autoApply: { state: "waiting", for: "certify", text: "" } }).text, /shows the test colours/);
  assert.equal(F.sessionNow({ ...base, autoApply: { state: "ready" } }).text, "Putting the results on the case…");
  // The reason is said once — in step 4, beside Retry; the top line points there.
  assert.deepEqual(F.sessionNow({ ...base, autoApply: { state: "refused", reason: "The case is past the counter." } }), { text: "Not on the case — see step 4.", tone: "bad" });
  assert.equal(F.answerStepText("complete", { state: "refused", reason: "The case is past the counter." }), "The case is past the counter.");
  assert.equal(F.sessionNow({ ...base, status: "applied", autoApply: { state: "applied" } }).text, "On case SU-AND-00140 — opening the answer…");
  for (const a of [{ state: "ready" }, { state: "waiting", for: "camera", text: "" }, { state: "applied" }] as const)
    assert.doesNotMatch(F.sessionNow({ ...base, autoApply: a }).text, /apply it|Apply to case/i);
  // Testing, the camera couldn't decide: the body and liquid can go now.
  assert.match(F.sessionNow({ ...base, status: "testing", phase: "test", progress: { done: 3, total: 12 }, certifyShown: true, autoApply: { state: "waiting", for: "tests", text: "" } }).text, /^Testing — 3 of 12 done; check the phone meanwhile \(step 3\)\.$/);
  // The phone's own line while it leads.
  const line = { text: "The customer's phone is showing its scan code.", tone: "fix" as const };
  assert.deepEqual(F.sessionNow({ ...base, status: "joined", phase: "scan", phoneLine: line, autoApply: null }), line);
  assert.match(F.sessionNow({ ...base, status: "waiting", autoApply: null }).text, /test code \(step 2\)/);
});
