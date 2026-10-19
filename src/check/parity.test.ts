// node --test --experimental-strip-types --no-warnings src/check/parity.test.ts
// Browser == app (owner, 2026-10-18: "Why swapup check in browser doesn't follow same"): the two
// builds used to draw their own finish screens (screens.tsx DoneScreen, NativeCheck.tsx NativeDone)
// and could drift. Now there is ONE result screen (./ResultScreen.tsx) and ONE answer component
// (../shared/AnswerBlock.tsx), which SwapUp Store draws the answer with too. This reads the source:
// the screens can't be rendered under plain node.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
/** The code without its comments (which may name the old screens, or quote the result's words). */
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("no build draws a finish screen of its own", () => {
  for (const f of ["./screens.tsx", "./NativeCheck.tsx", "./NativeCheck.web.tsx", "./CheckApp.tsx"]) {
    const s = code(f);
    assert.doesNotMatch(s, /function (DoneScreen|NativeDone|NativeApplied)\b/, f);
    assert.doesNotMatch(s, /\b(DoneScreen|NativeDone|NativeApplied)\b/, `${f} still names an old finish screen`);
    assert.doesNotMatch(s, /Checks complete|The store has your results|Nothing more to do here/, `${f} words a finish screen itself`);
  }
});

test("the native run and the browser run both finish on ResultScreen; the restarted-applied screen doesn't fork on the build", () => {
  for (const f of ["./CheckApp.tsx", "./NativeCheck.tsx"]) assert.match(src(f), /import \{ ResultScreen \} from "\.\/ResultScreen";/, f);
  const app = src("./CheckApp.tsx");
  const ended = app.slice(app.indexOf("if (state.ended === APPLIED_MESSAGE)"), app.indexOf("return <EndedScreen"));
  assert.match(ended, /<ResultScreen /);
  assert.doesNotMatch(ended, /IS_WEB/);
  // The browser stub keeps only the native runner out of the web bundle.
  assert.deepEqual([...src("./NativeCheck.web.tsx").matchAll(/export function (\w+)/g)].map((m) => m[1]), ["NativeCheck"]);
});

test("the result screen draws the answer with the shared AnswerBlock — the one SwapUp Store uses", () => {
  assert.match(src("./ResultScreen.tsx"), /import \{ AnswerBlock \} from "\.\.\/shared\/AnswerBlock";/);
  // Its words and states come from the pure, tested module — none of its own.
  const r = src("./ResultScreen.tsx");
  for (const fn of ["resultHead", "resultFacts", "clearDataGuide", "readAnswer"]) assert.match(r, new RegExp(`\\b${fn}\\(`), fn);
});

test("both polls stop once the answer is final (donePollMs → null)", () => {
  for (const f of ["./CheckApp.tsx", "./NativeCheck.tsx"]) {
    const s = src(f);
    assert.match(s, /if \(ms !== null\) t = setTimeout\(tick, ms\);/, f);
    assert.doesNotMatch(s, /setInterval\(/, `${f}: no fixed-interval re-read`);
  }
});
