// Refuse build output that must not ship (src/shared/buildScan.ts says what is checked and why).
//   node --experimental-strip-types --no-warnings scripts/check-builds.ts                  everything deploy.sh uploads
//   node --experimental-strip-types --no-warnings scripts/check-builds.ts web store        dist-web/store/ only
//   node --experimental-strip-types --no-warnings scripts/check-builds.ts apk check        dist/swapup-check.apk + .json
//   node --experimental-strip-types --no-warnings scripts/check-builds.ts apk-file <apk> store   one APK before it is copied to dist/
// Exit 0 = fine to ship; 1 = a finding (each printed on its own line); 2 = usage.
// ~/projects/swapup/deploy/deploy.sh should run the first form before it uploads anything.
import { fileURLToPath } from "node:url";

const S: typeof import("../src/shared/buildScan") = await import("../src/shared/buildScan" + ".ts");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const [what = "all", a, b] = process.argv.slice(2);
const usage = (): never => {
  console.error("usage: check-builds.ts [all|web|apk] [store|check|all]  |  check-builds.ts apk-file <apk> store|check");
  process.exit(2);
};
const variantsOf = (v: string | undefined): readonly ("store" | "check")[] =>
  !v || v === "all" ? S.VARIANTS : v === "store" || v === "check" ? [v] : usage();

let findings: { file: string; problem: string }[];
let label: string;
if (what === "apk-file") {
  if (!a || (b !== "store" && b !== "check")) usage();
  findings = S.scanApkFile(a!, b as "store" | "check", S.appVersion(ROOT));
  label = `${a} (${b})`;
} else if (what === "all" || what === "web" || what === "apk") {
  const variants = variantsOf(a);
  findings = S.scanBuilds(ROOT, what, variants);
  label = `${what === "all" ? "web + apk" : what} · ${variants.join(", ")} · version ${S.appVersion(ROOT)}`;
} else {
  usage();
}

if (findings!.length) {
  for (const f of findings!) console.error(`✗ ${f.file}: ${f.problem}`);
  console.error(`✗ ${findings!.length} problem(s) in the build output (${label!}) — not shipping it.`);
  process.exit(1);
}
console.log(`✓ build output fine to ship (${label!})`);
