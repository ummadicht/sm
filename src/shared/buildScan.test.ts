// node --test --experimental-strip-types --no-warnings src/shared/buildScan.test.ts
// The check on what ships (buildScan.ts, scripts/check-builds.ts): a browser build or an APK made
// before a copy change still carries the old words, and deploy.sh uploads dist-web/ and dist/ as
// they are. These build small stand-in builds in a temporary folder and check each refusal.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const S: typeof import("./buildScan") = await import("./buildScan" + ".ts");
const G: typeof import("./nameGuard") = await import("./nameGuard" + ".ts");

const REPO = fileURLToPath(new URL("../..", import.meta.url));
/** The partner's name, built from its letters so this file never holds it. */
const NAME = String.fromCharCode(99, 97, 115, 104, 105, 102, 121);
const Name = NAME[0].toUpperCase() + NAME.slice(1);
/** The old words, built from parts so this file never says them (copy.test.ts reads every file, this one too). */
const SAM = "Sam" + "ple";
const DEMO_P = ["Demo", "programme"].join(" ");
const OLD_DASH = `${SAM} price — not a real quote.`;
const OLD_COMMA = `${SAM} price, not a real quote.`;
const OLD_DEMO = `${DEMO_P} — ${SAM.toLowerCase()} data`;
const SAYS_PRICE = `says "${SAM} price"`;
const SAYS_DEMO = `says "${DEMO_P}"`;
const SAYS_DATA = `says "${SAM.toLowerCase()} data"`;

// ── a minimal zip writer (stored or deflated), enough to stand in for an APK
function zip(files: Record<string, Buffer | string>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, data);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Hermes-like bytecode: one-byte strings packed end to end, UTF-16 strings for anything outside Latin-1. */
function hermes(ascii: string[], wide: string[] = [], pad = 0): Buffer {
  return Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03]), Buffer.alloc(pad), Buffer.from(ascii.join(""), "latin1"), Buffer.from(wide.join(""), "utf16le")]);
}

const CLEAN_ASCII = ["ACCEL_NOISE_FLOOR", "SAMPLE_RATE", "No market price yet", "Refurbished market price", "PriceIQ"];
const CLEAN_WIDE = ["Test programme — no real money", "No market price yet — enter a quote.", "Refurbished market price ₹53,499 (Superb) − 2% · PriceIQ 2026-W35"];

const T0 = Date.parse("2026-10-18T08:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A stand-in repo: app.json at 0.8.0, one source file changed at T0, clean builds of both apps built an hour later. */
function fixture(): { root: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "swapup-buildscan-"));
  const put = (p: string, c: Buffer | string) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  };
  put("app.json", JSON.stringify({ expo: { version: "0.8.0" } }));
  put("src/store/buySell.ts", "export const x = 1;\n");
  for (const f of ["app.json", "src/store/buySell.ts"]) utimesSync(join(root, f), new Date(T0), new Date(T0));
  const built = iso(T0 + 3600_000);
  for (const v of S.VARIANTS) {
    const bundle = `/app/${v}/_expo/static/js/web/index-abc.js`;
    put(`dist-web/${v}/index.html`, `<title>SwapUp</title><script src="${bundle}"></script>`);
    put(`dist-web/${v}/_expo/static/js/web/index-abc.js`, `const a="Test programme — no real money";const b="No market price yet — enter a quote.";`);
    put(`dist-web/${v}/version.json`, JSON.stringify({ variant: v, version: "0.8.0", bundle, builtAt: built }));
    writeApk(root, v, {});
  }
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** dist/swapup-<v>.apk + its manifest; `over` changes the APK's parts or the manifest. */
function writeApk(root: string, v: "store" | "check", over: { bundle?: Buffer | null; config?: Record<string, unknown> | null; manifest?: Record<string, unknown> }) {
  const files: Record<string, Buffer | string> = { "AndroidManifest.xml": Buffer.from("manifest", "utf16le"), "lib/arm64-v8a/libhermes.so": Buffer.alloc(64) };
  if (over.bundle !== null) files["assets/index.android.bundle"] = over.bundle ?? hermes(CLEAN_ASCII, CLEAN_WIDE);
  if (over.config !== null) files["assets/app.config"] = JSON.stringify(over.config ?? { version: "0.8.0", extra: { variant: v } });
  const apk = zip(files);
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", `swapup-${v}.apk`), apk);
  const sha256 = createHash("sha256").update(apk).digest("hex");
  writeFileSync(join(root, "dist", `swapup-${v}.json`), JSON.stringify({ app: v, version: "0.8.0", bytes: apk.length, sha256, builtAt: iso(T0 + 3600_000), ...over.manifest }));
}

const problems = (fs: { problem: string }[]) => fs.map((f) => f.problem);

test("SHIPPED_PATTERNS: the repo's phrases without word boundaries, less the bare upper-case word", () => {
  assert.equal(S.SHIPPED_PATTERNS.length, G.MADE_UP_PRICE_PATTERNS.length - 1);
  for (const re of S.SHIPPED_PATTERNS) assert.ok(!re.source.includes(String.raw`\b`), String(re));
});

test("scanBytes: the old words, in plain text, packed end to end (Hermes), and as UTF-16 at either alignment", () => {
  const old = [OLD_DASH, OLD_DEMO, OLD_COMMA];
  for (const s of old) assert.notDeepEqual(S.scanBytes("x.js", Buffer.from(`const a="${s}"`, "utf8")), [], s);
  // Packed: no boundary before or after.
  assert.deepEqual(problems(S.scanBytes("b", hermes([`ACCEL_NOISE_FLOOR_GRACE_AFTER_COSMETIC_M${OLD_COMMA}ACTION: alr`]))), [SAYS_PRICE]);
  for (const pad of [0, 1]) {
    assert.deepEqual(problems(S.scanBytes("b", hermes(CLEAN_ASCII, [OLD_DEMO], pad))).sort(), [SAYS_DEMO, SAYS_DATA].sort(), `pad ${pad}`);
  }
  // Every distinct wording is listed, not just the first.
  assert.equal(S.scanBytes("x.js", Buffer.from(`${SAM} price. ${SAM} price. ${SAM.toLowerCase()} quote`, "utf8")).length, 2);
});

test("scanBytes: the partner's name, in any case and packed or wide — reported without ever spelling it", () => {
  const cases = [
    hermes([`Enter the ${Name} quote on the full case`]),
    hermes([`COSMETIC_M${Name}SellACTION`]),
    hermes([], [`What ${Name} pays once it is repaired — ₹`], 0),
    hermes([], [`What ${Name} pays once it is repaired — ₹`], 1),
    Buffer.from(`const u="${NAME.toUpperCase()}_URL"`, "utf8"),
  ];
  for (const b of cases) {
    const f = S.scanBytes("bundle", b);
    assert.deepEqual(problems(f), ["names the buyback partner"]);
    assert.equal(G.namesPartner(JSON.stringify(f)), false);
  }
  assert.deepEqual(problems(S.scanBytes(`assets/${NAME}.png`, Buffer.alloc(8))), ["names the buyback partner"]);
});

test("scanBytes: today's words, library constants and binary noise pass", () => {
  assert.deepEqual(S.scanBytes("b", hermes(CLEAN_ASCII, CLEAN_WIDE)), []);
  assert.deepEqual(S.scanBytes("b", hermes(CLEAN_ASCII, CLEAN_WIDE, 1)), []);
  assert.deepEqual(S.scanBytes("x.js", Buffer.from(`const ${SAM.toUpperCase()}=1;const r="SAMPLE_RATE";const c="cashier classify";`, "utf8")), []);
  assert.deepEqual(S.scanBytes("x.bin", Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256))), []);
});

test("zipEntries reads stored and deflated entries; anything else is refused", () => {
  const big = Buffer.from("x".repeat(10_000) + OLD_DASH, "utf8");
  for (const deflate of [true, false]) {
    const e = S.zipEntries(zip({ "assets/app.config": '{"version":"0.8.0"}', "assets/index.android.bundle": big }, deflate));
    assert.deepEqual([...e.keys()], ["assets/app.config", "assets/index.android.bundle"]);
    assert.equal(e.get("assets/app.config")!().toString(), '{"version":"0.8.0"}');
    assert.ok(e.get("assets/index.android.bundle")!().equals(big));
  }
  assert.throws(() => S.zipEntries(Buffer.from("not a zip at all, just some bytes")), /not a zip/);
});

test("clean builds of both apps, at app.json's version and newer than the source, may ship", () => {
  const { root, done } = fixture();
  try {
    assert.deepEqual(S.scanBuilds(root), []);
    assert.deepEqual(S.scanBuilds(root, "web", ["store"]), []);
    assert.deepEqual(S.scanBuilds(root, "apk", ["check"]), []);
  } finally {
    done();
  }
});

test("a browser build with the old words, another version, another app or a missing bundle is refused", () => {
  const { root, done } = fixture();
  try {
    const js = join(root, "dist-web/store/_expo/static/js/web/index-abc.js");
    writeFileSync(js, `const a="${OLD_DEMO}";const b="${OLD_DASH}";const c="Enter the ${Name} quote";`);
    assert.deepEqual(problems(S.scanWebBuild(root, "store")).sort(), [SAYS_DEMO, SAYS_PRICE, SAYS_DATA, "names the buyback partner"].sort());
    assert.ok(S.scanWebBuild(root, "store").every((f) => f.file === "dist-web/store/_expo/static/js/web/index-abc.js"));
    assert.deepEqual(S.scanWebBuild(root, "check"), []);

    const vj = join(root, "dist-web/check/version.json");
    const v = JSON.parse(readFileSync(vj, "utf8"));
    writeFileSync(vj, JSON.stringify({ ...v, version: "0.7.0", variant: "store", bundle: "/app/check/_expo/static/js/web/index-gone.js" }));
    assert.deepEqual(problems(S.scanWebBuild(root, "check")), [
      'is for "store", not check',
      "is version 0.7.0, not app.json's 0.8.0",
      "names a bundle that is not there (/app/check/_expo/static/js/web/index-gone.js)",
    ]);
    rmSync(vj);
    assert.deepEqual(problems(S.scanWebBuild(root, "check")), ["missing or unreadable"]);
    rmSync(join(root, "dist-web/check"), { recursive: true });
    assert.deepEqual(S.scanWebBuild(root, "check"), [{ file: "dist-web/check", problem: "missing — run bash scripts/export-web.sh check" }]);
  } finally {
    done();
  }
});

test("a build made before the source last changed is refused; test files and the checks themselves don't count", () => {
  const { root, done } = fixture();
  try {
    const later = new Date(T0 + 2 * 3600_000);
    for (const f of ["src/store/buySell.test.ts", "src/shared/nameGuard.ts", "src/shared/buildScan.ts"]) {
      mkdirSync(dirname(join(root, f)), { recursive: true });
      writeFileSync(join(root, f), "//\n");
      utimesSync(join(root, f), later, later);
    }
    assert.deepEqual(S.scanBuilds(root), []);
    assert.equal(S.newestSource(root)?.file, "src/store/buySell.ts");

    utimesSync(join(root, "src/store/buySell.ts"), later, later);
    const f = S.scanBuilds(root);
    assert.deepEqual(
      f.map((x) => x.file),
      ["dist-web/store/version.json", "dist/swapup-store.json", "dist-web/check/version.json", "dist/swapup-check.json"]
    );
    assert.match(f[0].problem, /^was built 2026-10-18T09:00:00\.000Z, before src\/store\/buySell\.ts changed \(2026-10-18T10:00:00\.000Z\) — rebuild$/);
    // Within the build's own second is not "after".
    const same = new Date(T0 + 3600_000 + 500);
    utimesSync(join(root, "src/store/buySell.ts"), same, same);
    assert.deepEqual(S.scanBuilds(root), []);
  } finally {
    done();
  }
});

test("an APK with the old words, another version or app, no bundle, or a manifest for another file is refused", () => {
  const { root, done } = fixture();
  try {
    writeApk(root, "store", { bundle: hermes([`Price this phone in the ${Name} app`, `COSMETIC_M${OLD_COMMA}ACTION`], [OLD_DEMO]) });
    assert.deepEqual(problems(S.scanApkRelease(root, "store")).sort(), [SAYS_DEMO, SAYS_PRICE, SAYS_DATA, "names the buyback partner"].sort());
    assert.ok(S.scanApkRelease(root, "store").every((f) => f.file === "dist/swapup-store.apk!assets/index.android.bundle"));

    writeApk(root, "store", { config: { version: "0.7.0", extra: { variant: "check" } }, manifest: { version: "0.7.0" } });
    assert.deepEqual(problems(S.scanApkRelease(root, "store")), [
      "is version 0.7.0, not app.json's 0.8.0",
      'opens the "check" app, not store',
      "is version 0.7.0, not app.json's 0.8.0",
    ]);

    writeApk(root, "store", { bundle: null, config: null });
    assert.deepEqual(problems(S.scanApkRelease(root, "store")), ["has no JS bundle (assets/index.android.bundle)", "has no readable embedded config (assets/app.config)"]);

    writeApk(root, "store", { manifest: { sha256: "0".repeat(64) } });
    assert.deepEqual(problems(S.scanApkRelease(root, "store")), ["does not describe dist/swapup-store.apk (size or sha256 differ)"]);

    writeFileSync(join(root, "dist/swapup-store.apk"), "garbage");
    assert.match(problems(S.scanApkRelease(root, "store"))[0], /^unreadable \(not a zip/);

    rmSync(join(root, "dist/swapup-check.apk"));
    assert.deepEqual(S.scanApkRelease(root, "check"), [{ file: "dist/swapup-check.apk", problem: "missing — run bash scripts/build-apk.sh check" }]);
  } finally {
    done();
  }
});

test("scripts/check-builds.ts: 0 for a clean APK, 1 with the findings (name never printed), 2 for bad usage", () => {
  const { root, done } = fixture();
  const cli = join(REPO, "scripts/check-builds.ts");
  const run = (args: string[]) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", cli, ...args], { encoding: "utf8", stdio: "pipe" }) };
    } catch (e) {
      const x = e as { status: number; stdout: string; stderr: string };
      return { code: x.status, out: x.stdout + x.stderr };
    }
  };
  try {
    const version = S.appVersion(REPO);
    const apk = join(root, "one.apk");
    writeFileSync(apk, zip({ "assets/index.android.bundle": hermes(CLEAN_ASCII, CLEAN_WIDE), "assets/app.config": JSON.stringify({ version, extra: { variant: "store" } }) }));
    const ok = run(["apk-file", apk, "store"]);
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /✓ build output fine to ship/);

    writeFileSync(apk, zip({ "assets/index.android.bundle": hermes([`Enter the ${Name} quote`, OLD_DASH]), "assets/app.config": JSON.stringify({ version, extra: { variant: "check" } }) }));
    const bad = run(["apk-file", apk, "store"]);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /names the buyback partner/);
    assert.ok(bad.out.includes(SAYS_PRICE), bad.out);
    assert.match(bad.out, /opens the "check" app, not store/);
    assert.match(bad.out, /not shipping it/);
    assert.equal(G.namesPartner(bad.out), false);

    assert.equal(run(["apk-file", apk]).code, 2);
    assert.equal(run(["web", "tablet"]).code, 2);
    assert.equal(run(["everything"]).code, 2);
  } finally {
    done();
  }
});

test("app.config.js builds the version app.json says (the APK takes app.config.js's, the checks app.json's)", () => {
  const req = createRequire(import.meta.url);
  const cfg = req(join(REPO, "app.config.js"));
  for (const variant of ["store", "check"]) {
    const prev = process.env.APP_VARIANT;
    process.env.APP_VARIANT = variant;
    try {
      assert.equal((typeof cfg === "function" ? cfg({ config: {} }) : cfg).version, S.appVersion(REPO), variant);
    } finally {
      if (prev === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = prev;
    }
  }
});
