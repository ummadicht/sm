// node --test --experimental-strip-types --no-warnings src/shared/copy.test.ts
// The owner, 2026-10-17/18: the buyback partner is never named — no word the apps show, and no
// comment, identifier, test, doc or file name either — and there are no made-up prices: no
// price marked "sample", no such rate card, no seeded example data. Prices come from PriceIQ (through the
// SwapUp server) or a partner's uploaded rate card, never typed in; with none, the
// answer says so. A test programme says so in one short banner. These checks read the whole
// repo (installed packages and build output aside), this file included.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const G: typeof import("./nameGuard") = await import("./nameGuard" + ".ts");

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FILES = G.repoFiles(ROOT);

test("the repo has the files the checks read", () => {
  const paths = FILES.map((f) => f.path.replace(/\\/g, "/"));
  for (const p of ["README.md", "app.config.js", "src/store/offer.ts", "src/store/refurbEconomics.ts", "src/store/screens/Offer.tsx", "src/shared/copy.test.ts"]) assert.ok(paths.includes(p), p);
  assert.ok(FILES.filter((f) => f.text !== null).length > 100);
});

test("no file in the repo names the buyback partner — not its text, not its name", () => {
  const hits = FILES.filter((f) => G.namesPartner(f.path) || (f.text !== null && G.namesPartner(f.text))).map((f) => f.path);
  assert.deepEqual(hits, []);
});

test("the name check finds the name in any case and inside identifiers, without spelling it", () => {
  // Built from its letters here, so this file never holds it.
  const name = String.fromCharCode(99, 97, 115, 104, 105, 102, 121);
  for (const s of [name, name.toUpperCase(), `Enter the ${name[0].toUpperCase()}${name.slice(1)} quote`, `${name.toUpperCase()}_URL`, `priceIQ${name}Sell`, `${name}/sell`, `${name}_in_sell`]) {
    assert.equal(G.namesPartner(s), true, s);
  }
  for (const s of ["", "cash", "cashier", "classify", "PriceIQ refurbished market price", "Refurbished market price ₹53,499 (Superb) − 2% · PriceIQ 2026-W35"]) {
    assert.equal(G.namesPartner(s), false, s);
  }
});

test("no file says a price is a sample, or calls a programme a demo", () => {
  const phrases = G.MADE_UP_PRICE_PATTERNS;
  const hits = FILES.flatMap((f) =>
    f.text === null
      ? []
      : f.text
          .split("\n")
          .filter((line) => phrases.some((re) => re.test(line)))
          .map((line) => `${f.path}: ${line.trim()}`)
  );
  assert.deepEqual(hits, []);
});
