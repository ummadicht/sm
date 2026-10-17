// node --test --experimental-strip-types --no-warnings src/check/identify.test.ts
// The confirm card's storage question (swapup offer spec A10): the join's
// `identity.variants` and when "How much storage?" is asked. Same import trick as
// src/store/buySell.test.ts.
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

test("confirmStorage asks only when the size is unknown and there is more than one", () => {
  assert.deepEqual(C.confirmStorage(s23u()), { ask: true, options: ["256GB", "512GB"] });
  assert.deepEqual(C.confirmStorage(s23u({ variants: ["128GB", "256GB", "512GB"] })).options, ["128GB", "256GB", "512GB"], "every size, in the server's order");

  const no = { ask: false, options: [] };
  assert.deepEqual(C.confirmStorage(s23u({ variant: "256GB" })), no, "the phone measured it — the measurement wins, nothing to ask");
  assert.deepEqual(C.confirmStorage(s23u({ variants: ["256GB"] })), no, "one size — the server fills it from the catalogue");
  assert.deepEqual(C.confirmStorage(s23u({ variants: [] })), no, "an older server sent no sizes — the advisor asks, as before");
  // The phone measured 1TB, which isn't a size on file: the server sends variant null and no sizes.
  // The customer must not be offered 256GB / 512GB for a 1TB phone — the advisor checks Settings.
  assert.deepEqual(C.confirmStorage(s23u({ variant: null, variants: [], reason: "Storage reads 1000.2 GB (1TB), which is not a storage option on file." })), no, "measured off the list — nothing asked");
  assert.deepEqual(C.confirmStorage(s23u({ match: "none" })), no, "nothing matched — the picker asks storage instead");
  assert.deepEqual(C.confirmStorage(s23u({ modelId: null })), no, "no model id — a pick would have nothing to name");
  assert.deepEqual(C.confirmStorage(s23u({ label: null })), no, "no name — there is no card to ask on");
  assert.deepEqual(C.confirmStorage(null), no, "an older server sends no identity");
  assert.deepEqual(C.confirmStorage(undefined), no);

  // A check saved on disk by an app older than `variants`: its identity has none.
  const saved = { ...s23u() } as Partial<Identity>;
  delete saved.variants;
  assert.deepEqual(C.confirmStorage(saved as Identity), no, "a resumed older check — no throw, nothing asked");
});

test("the confirm card's line stays the matched name until the size is known", () => {
  assert.equal(C.identityLine("Samsung Galaxy S23 Ultra", s23u().variant), "Samsung Galaxy S23 Ultra");
  assert.equal(C.identityLine("Samsung Galaxy S23 Ultra", "256GB"), "Samsung Galaxy S23 Ultra · 256GB");
});
