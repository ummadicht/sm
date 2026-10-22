// node --test --experimental-strip-types --no-warnings src/check/identify.test.ts
// The join's `identity`, storage sizes included. The customer is no longer asked to
// confirm the model or its storage (2026-10-17): a recognised phone goes straight to the
// scan (core.ts identifyDone, tested in src/diagnostics/auto/phoneled.test.ts). Same
// import trick as src/store/pin.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const C: typeof import("./core") = await import("./core" + ".ts");

type Identity = import("./core").Identity;

/** The S23 Ultra as the server matches it from SM-S918B: two sizes, none measured (a browser run). */
const s23u = (over: Partial<Identity> = {}): Identity => ({
  label: "Samsung Galaxy S23 Ultra",
  match: "exact",
  reason: "Model code SM-S918B is the Galaxy S23 Ultra.",
  variant: null,
  modelId: "galaxy-s23-ultra",
  variants: ["256GB", "512GB"],
  ...over,
});

test("parseIdentity reads the model's storage sizes", () => {
  const raw = { label: "Samsung Galaxy S23 Ultra", match: "exact", reason: "Model code SM-S918B is the Galaxy S23 Ultra.", variant: null, modelId: "galaxy-s23-ultra" };
  assert.deepEqual(C.parseIdentity({ ...raw, variants: ["256GB", "512GB"] }), s23u(), "the server's list, in its order");
  assert.deepEqual(C.parseIdentity(raw)?.variants, [], "an older server sends none");
  assert.deepEqual(C.parseIdentity({ ...raw, variants: "256GB" })?.variants, [], "not a list → none, never a throw");
  assert.deepEqual(C.parseIdentity({ ...raw, variants: [" 256GB ", "", null, 512, "256GB", "512GB"] })?.variants, ["256GB", "512GB"], "trimmed, blanks and junk dropped, no repeats");
  assert.deepEqual(C.parseIdentity({ ...raw, label: null, variants: ["256GB", "512GB"] })?.variants, [], "no match → no sizes: there is no model to size");
  assert.deepEqual(C.parseIdentity({ ...raw, match: "none", variants: ["256GB", "512GB"] })?.variants, []);
  assert.deepEqual(C.parseIdentity({ ...raw, match: "family", variants: ["128GB", "256GB"] })?.variants, ["128GB", "256GB"], "a family match is still a model");
});
