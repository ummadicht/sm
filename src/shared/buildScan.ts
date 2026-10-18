// The check on what SHIPS (owner, 2026-10-18): the browser builds in dist-web/<app>/ and the APKs in
// dist/ are uploaded as they are by ~/projects/swapup/deploy/deploy.sh — to /app/<app>/ and to
// /downloads. A build made before a copy change still carries the old words, so the repo-wide
// check (copy.test.ts) is not enough: this reads the build output itself and refuses it when
//   - any shipped file names the buyback partner (the hashed check in nameGuard.ts — never spelled),
//   - any shipped file calls a price made up or a programme a demo (MADE_UP_PRICE_PATTERNS),
//   - its version is not app.json's, or (APKs) its manifest doesn't describe the file next to it,
//   - it was built before the app's source last changed.
// The APK's JS is Hermes bytecode: its strings are stored as plain bytes, or as UTF-16 when they hold
// a character outside Latin-1 ("—", "₹"), so every file is read three ways (bytes, and UTF-16 at
// both alignments). Tooling only: nothing the apps bundle imports this file (it needs node:fs).
// CLI: scripts/check-builds.ts.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { inflateRawSync } from "node:zlib";

const G: typeof import("./nameGuard") = await import("./nameGuard" + ".ts");

export type Variant = "store" | "check";
export const VARIANTS: readonly Variant[] = ["store", "check"];

/** One reason a build must not ship. `file` is relative to the repo root where it can be. */
export type Finding = { file: string; problem: string };

/** The ways a file's bytes are read as text: as bytes (ASCII / UTF-8 / Hermes one-byte strings), and as UTF-16 at both alignments. */
export function textViews(buf: Buffer): string[] {
  const views = [buf.toString("latin1")];
  if (buf.length >= 2) views.push(buf.toString("utf16le"), buf.subarray(1).toString("utf16le"));
  return views;
}

const BARE_WORD = String.raw`\bSAMPLE\b`;
/**
 * The repo's MADE_UP_PRICE_PATTERNS, as they can be found in a build: without word boundaries,
 * because Hermes packs its strings end to end ("…_MSample price, not a real quote.ACTION…") so
 * there is no boundary to find; and without the bare upper-case word, which is how the repo check
 * catches an identifier — a bundle's own library constants (SAMPLE_RATE…) would match it here.
 */
export const SHIPPED_PATTERNS: readonly RegExp[] = G.MADE_UP_PRICE_PATTERNS.filter((re) => re.source !== BARE_WORD).map(
  (re) => new RegExp(re.source.split(String.raw`\b`).join(""), re.flags.replace("g", "") + "g")
);

/** What is wrong with the words in one file's bytes. The partner's name is never printed — only that it is there. */
export function scanBytes(file: string, buf: Buffer): Finding[] {
  const out: Finding[] = [];
  const views = textViews(buf);
  if (G.namesPartner(file) || views.some((v) => G.namesPartner(v))) out.push({ file, problem: "names the buyback partner" });
  const said = new Set<string>();
  for (const v of views) for (const re of SHIPPED_PATTERNS) for (const m of v.matchAll(re)) said.add(m[0]);
  for (const w of said) out.push({ file, problem: `says "${w}"` });
  return out;
}

/** Every entry of a zip (an APK), by name — stored or deflated, no zip64 (an APK is far below 4 GB). */
export function zipEntries(zip: Buffer): Map<string, () => Buffer> {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const entries = new Map<string, () => Buffer>();
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("broken zip directory");
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, () => {
      if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`broken zip entry ${name}`);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`zip entry ${name}: compression ${method} not read`);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** The version the apps are built as: app.json's (app.config.js must say the same — a test holds that). */
export function appVersion(root: string): string {
  return JSON.parse(readFileSync(join(root, "app.json"), "utf8")).expo.version;
}

/** Where a build's words come from: a change to any of these after a build means the build is old. */
const SOURCE_DIRS = ["src", "assets"];
const SOURCE_FILES = ["App.tsx", "index.ts", "app.json", "app.config.js", "package.json", "package-lock.json"];
/** Test-only and tooling files never reach a build. */
const notShipped = (p: string) => /\.test\.tsx?$/.test(p) || /(^|\/)(nameGuard|buildScan)\.ts$/.test(p);

/** The app's newest source file (path relative to `root`, and when it last changed). */
export function newestSource(root: string): { file: string; at: number } | null {
  let best: { file: string; at: number } | null = null;
  const consider = (p: string) => {
    const rel = relative(root, p).replace(/\\/g, "/");
    if (notShipped(rel)) return;
    const at = statSync(p).mtimeMs;
    if (!best || at > best.at) best = { file: rel, at };
  };
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) consider(p);
    }
  };
  for (const d of SOURCE_DIRS) if (existsSync(join(root, d))) walk(join(root, d));
  for (const f of SOURCE_FILES) if (existsSync(join(root, f))) consider(join(root, f));
  return best;
}

function staleness(file: string, builtAt: unknown, source: { file: string; at: number } | null): Finding[] {
  const at = typeof builtAt === "string" ? Date.parse(builtAt) : NaN;
  if (!Number.isFinite(at)) return [{ file, problem: "has no build time" }];
  // builtAt is written to the second, after the build: a source change in that same second is not "after".
  if (source && source.at >= at + 1000) {
    return [{ file, problem: `was built ${new Date(at).toISOString()}, before ${source.file} changed (${new Date(source.at).toISOString()}) — rebuild` }];
  }
  return [];
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** dist-web/<variant>/: every file it ships, and its version.json. */
export function scanWebBuild(root: string, variant: Variant, opts: { version?: string; source?: { file: string; at: number } | null } = {}): Finding[] {
  const dir = join(root, "dist-web", variant);
  const rel = (p: string) => relative(root, p).replace(/\\/g, "/");
  if (!existsSync(dir)) return [{ file: rel(dir), problem: `missing — run bash scripts/export-web.sh ${variant}` }];
  const version = opts.version ?? appVersion(root);
  const source = opts.source === undefined ? newestSource(root) : opts.source;
  const out: Finding[] = [];
  for (const f of filesUnder(dir)) out.push(...scanBytes(rel(f), readFileSync(f)));
  const vj = join(dir, "version.json");
  const v = readJson(vj);
  if (!v) return [...out, { file: rel(vj), problem: "missing or unreadable" }];
  if (v.variant !== variant) out.push({ file: rel(vj), problem: `is for "${String(v.variant)}", not ${variant}` });
  if (v.version !== version) out.push({ file: rel(vj), problem: `is version ${String(v.version)}, not app.json's ${version}` });
  if (typeof v.bundle === "string") {
    const base = `/app/${variant}`;
    const bundle = v.bundle.startsWith(base + "/") ? join(dir, v.bundle.slice(base.length + 1)) : null;
    if (!bundle || !existsSync(bundle)) out.push({ file: rel(vj), problem: `names a bundle that is not there (${v.bundle})` });
  }
  out.push(...staleness(rel(vj), v.builtAt, source));
  return out;
}

/** APK entries that hold the app's words (the JS bundle, its config, resources) — not native libraries or Java code. */
const wordsEntry = (name: string) => name.startsWith("assets/") || name === "resources.arsc" || name === "AndroidManifest.xml" || (name.startsWith("res/") && name.endsWith(".xml"));

/** One APK file: its words, and the version and app its embedded config says. */
export function scanApkFile(apk: string, variant: Variant, version: string, label = apk): Finding[] {
  if (!existsSync(apk)) return [{ file: label, problem: `missing — run bash scripts/build-apk.sh ${variant}` }];
  let entries: Map<string, () => Buffer>;
  try {
    entries = zipEntries(readFileSync(apk));
  } catch (e) {
    return [{ file: label, problem: `unreadable (${(e as Error).message})` }];
  }
  const out: Finding[] = [];
  for (const [name, read] of entries) if (wordsEntry(name)) out.push(...scanBytes(`${label}!${name}`, read()));
  const cfgRead = entries.get("assets/app.config");
  if (!entries.has("assets/index.android.bundle")) out.push({ file: label, problem: "has no JS bundle (assets/index.android.bundle)" });
  let cfg: Record<string, unknown> | null = null;
  try {
    cfg = cfgRead ? JSON.parse(cfgRead().toString("utf8")) : null;
  } catch {
    cfg = null;
  }
  if (!cfg) return [...out, { file: label, problem: "has no readable embedded config (assets/app.config)" }];
  if (cfg.version !== version) out.push({ file: label, problem: `is version ${String(cfg.version)}, not app.json's ${version}` });
  const extra = cfg.extra && typeof cfg.extra === "object" ? (cfg.extra as Record<string, unknown>) : {};
  if (extra.variant !== variant) out.push({ file: label, problem: `opens the "${String(extra.variant)}" app, not ${variant}` });
  return out;
}

/** dist/swapup-<variant>.apk and its .json manifest: the APK's checks, and the manifest describes that very file. */
export function scanApkRelease(root: string, variant: Variant, opts: { version?: string; source?: { file: string; at: number } | null } = {}): Finding[] {
  const apk = join(root, "dist", `swapup-${variant}.apk`);
  const mf = join(root, "dist", `swapup-${variant}.json`);
  const rel = (p: string) => relative(root, p).replace(/\\/g, "/");
  const version = opts.version ?? appVersion(root);
  const source = opts.source === undefined ? newestSource(root) : opts.source;
  const out = scanApkFile(apk, variant, version, rel(apk));
  if (!existsSync(apk)) return out;
  const m = readJson(mf);
  if (!m) return [...out, { file: rel(mf), problem: "missing or unreadable" }];
  if (m.app !== variant) out.push({ file: rel(mf), problem: `is for "${String(m.app)}", not ${variant}` });
  if (m.version !== version) out.push({ file: rel(mf), problem: `is version ${String(m.version)}, not app.json's ${version}` });
  const bytes = readFileSync(apk);
  if (m.bytes !== bytes.length || m.sha256 !== createHash("sha256").update(bytes).digest("hex")) {
    out.push({ file: rel(mf), problem: `does not describe ${rel(apk)} (size or sha256 differ)` });
  }
  out.push(...staleness(rel(mf), m.builtAt, source));
  return out;
}

/** Everything deploy.sh would ship (or the part asked for). */
export function scanBuilds(root: string, what: "web" | "apk" | "all" = "all", variants: readonly Variant[] = VARIANTS): Finding[] {
  const version = appVersion(root);
  const source = newestSource(root);
  const out: Finding[] = [];
  for (const v of variants) {
    if (what !== "apk") out.push(...scanWebBuild(root, v, { version, source }));
    if (what !== "web") out.push(...scanApkRelease(root, v, { version, source }));
  }
  return out;
}
