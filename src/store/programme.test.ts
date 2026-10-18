// node --test --experimental-strip-types --no-warnings src/store/programme.test.ts
// The test-programme banner (./programme.ts): the server says a programme is a test one; the app
// says so in one short line. Same import trick as ./pin.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const P: typeof import("./programme") = await import("./programme" + ".ts");

test("a test programme gets the one short banner, in the owner's words", () => {
  assert.equal(P.TEST_PROGRAMME, "Test programme — no real money");
  assert.equal(P.programmeBanner({ demo: true }), P.TEST_PROGRAMME);
  assert.ok(P.TEST_PROGRAMME.split(/\s+/).length <= 6, "a banner, not a paragraph");
});

test("a real programme, no programme, or anything but an explicit true: no banner", () => {
  for (const org of [{ demo: false }, { demo: "true" }, { demo: 1 }, {}, null, undefined]) assert.equal(P.programmeBanner(org), null, JSON.stringify(org));
});
