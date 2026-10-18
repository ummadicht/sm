// The buyback partner is never named in this repo (owner, 2026-10-17: no reference anywhere —
// not on a screen, in a comment, an identifier, a test, a doc or a file name). The checks that
// enforce it can't spell the name either, so they compare every 7-letter run of text with the
// name's SHA-256. Test-only: nothing the apps bundle imports this file (it needs node:crypto).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

const NAME_SHA256 = "5d438033ba8011f147c966d40111bb23203fd3c34fd29ad0e3c734a2d86abe0f";
const NAME_LENGTH = 7;
/** The sum of the name's character codes: a cheap first test, so only a handful of runs are hashed. */
const NAME_CODE_SUM = 743;

/** True when `text` contains the partner's name anywhere, in any case, even inside an identifier ("fooNameBar", "NAME_URL"). */
export function namesPartner(text: string): boolean {
  for (const run of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (run.length < NAME_LENGTH) continue;
    let sum = 0;
    for (let i = 0; i < run.length; i++) {
      sum += run.charCodeAt(i);
      if (i >= NAME_LENGTH) sum -= run.charCodeAt(i - NAME_LENGTH);
      if (i < NAME_LENGTH - 1 || sum !== NAME_CODE_SUM) continue;
      const window = run.slice(i - NAME_LENGTH + 1, i + 1);
      if (createHash("sha256").update(window).digest("hex") === NAME_SHA256) return true;
    }
  }
  return false;
}

/**
 * Words that call a price made up, or a programme a demo (owner, 2026-10-18: no made-up prices,
 * a test programme says "Test programme — no real money"). Checked in the repo's files
 * (copy.test.ts) and in the build output that ships (buildScan.ts).
 */
export const MADE_UP_PRICE_PATTERNS: readonly RegExp[] = [
  /\bsample[ -](price|prices|rate[ -]card|card|data|quote|figure|deduction|deductions)\b/i,
  /\bSAMPLE\b/,
  /\bdemo\s+programme\b/i,
];

/** Folders that are not the repo's own words: installed packages, build output, native projects. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".expo", "dist", "dist-web", "android", "ios"]);
/** Files read as text; anything else (images, fonts, APKs) is checked by its name only. */
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".sh", ".html", ".css", ".txt", ".yml", ".yaml", ".xml", ".gradle", ".properties", ""]);

/** Every file of the repo (paths relative to `root`), with its text when it is a text file. */
export function repoFiles(root: string): { path: string; text: string | null }[] {
  const out: { path: string; text: string | null }[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
        continue;
      }
      if (!e.isFile()) continue;
      const text = TEXT_EXT.has(extname(e.name).toLowerCase()) ? readFileSync(p, "utf8") : null;
      out.push({ path: relative(root, p), text });
    }
  };
  walk(root);
  return out;
}
