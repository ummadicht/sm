// node --test --experimental-strip-types --no-warnings src/shared/api.test.ts
// The one HTTP client (./api.ts), SUP-27: every call says which app and build is calling
// (X-SwapUp-App: store/0.9.3+15), and the server's refusal of an old build — HTTP 426, one
// sentence — reaches the screens word for word. Same resolve hook as ../check/engine.test.ts:
// ../store/staffClient.ts and ../check/engine.ts import their siblings without an extension.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); }
        catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]sx?$/.test(s)) return next(s + ".ts", c); throw e; }
      }`
    )
);

const A: typeof import("./api") = await import("./api" + ".ts");
const SC: typeof import("../store/staffClient") = await import("../store/staffClient" + ".ts");
const E: typeof import("../check/engine") = await import("../check/engine" + ".ts");

const SERVER = "https://swapup.example.in";
const UPDATE = "Update SwapUp Store from /downloads.";

type Call = { url: string; method: string; headers: Record<string, string> };
function stubFetch(answer: () => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method), headers: { ...((init?.headers ?? {}) as Record<string, string>) } });
    return answer();
  }) as typeof fetch;
  return calls;
}
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });

test("appIdOf: app/version+versionCode — and nothing when the build doesn't know them", () => {
  assert.equal(A.APP_HEADER, "x-swapup-app");
  assert.equal(A.appIdOf("store", "0.9.3", 15), "store/0.9.3+15");
  assert.equal(A.appIdOf("check", "0.9.3", "15"), "check/0.9.3+15", "the browser export inlines it as text");
  for (const code of [null, undefined, 0, -1, 1.5, "", "15a", "1e1", NaN]) assert.equal(A.appIdOf("store", "0.9.3", code), null, String(code));
  for (const v of [null, undefined, "", "web-0.9.3", "0.9.3 beta"]) assert.equal(A.appIdOf("store", v, 15), null, String(v));
  assert.equal(A.appIdOf("desk", "0.9.3", 15), null);
});

test("every call carries X-SwapUp-App — GET, POST and PATCH, signed in or not, any kind of token", async () => {
  A.identifyApp("store/0.9.3+15");
  const calls = stubFetch(() => json({ ok: true }));
  const auths: import("./api").Auth[] = [null, { kind: "bearer", token: "b" }, { kind: "ticket", token: "t" }, { kind: "device", token: "d" }];
  for (const auth of auths) {
    const c = A.createClient(SERVER, auth);
    await c.get("/api/me");
    await c.post("/api/cases/c1/action", { action: "reprice" });
    await c.patch("/api/cases/c1", { variant: "256GB" });
  }
  assert.equal(calls.length, 12);
  for (const call of calls) assert.equal(call.headers["x-swapup-app"], "store/0.9.3+15", `${call.method} ${call.url}`);
  // The staff client (the Store app's every screen) is the same client.
  await SC.staffClient(SERVER, "b", () => {}).get("/api/cases");
  assert.equal(calls.at(-1)!.headers["x-swapup-app"], "store/0.9.3+15");
  // A build that doesn't know its versionCode sends none (never a made-up one).
  A.identifyApp(null);
  await A.createClient(SERVER, null).get("/api/me");
  assert.equal("x-swapup-app" in calls.at(-1)!.headers, false);
});

test("the build's own config names it: app.config.js's version and versionCode, read once by ./config at start-up", () => {
  const cfg = createRequire(import.meta.url)("../../app.config.js")();
  assert.ok(Number.isInteger(cfg.android.versionCode) && cfg.android.versionCode > 0);
  assert.equal(A.appIdOf(cfg.extra.variant, cfg.version, cfg.android.versionCode), `${cfg.extra.variant}/${cfg.version}+${cfg.android.versionCode}`);
  const config = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
  assert.match(config, /identifyApp\(appIdOf\(VARIANT, BUILD_VERSION, BUILD_CODE\)\)/);
  assert.match(config, /Constants\.expoConfig\?\.android\?\.versionCode/, "native: the APK's embedded config");
  assert.match(config, /process\.env\.EXPO_PUBLIC_APP_VERSION_CODE/, "browser: inlined at export");
  const exportWeb = readFileSync(new URL("../../scripts/export-web.sh", import.meta.url), "utf8");
  assert.match(exportWeb, /EXPO_PUBLIC_APP_VERSION_CODE="\$VERSION_CODE"/, "the browser export inlines the versionCode");
  // App.tsx loads ./config before either app (and so before any call).
  const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.ok(app.indexOf("./src/shared/config") > -1 && app.indexOf("./src/shared/config") < app.indexOf("./src/store/StoreApp"));
});

test("426 from the server (an old build): its one sentence, word for word, wherever errors show", async () => {
  A.identifyApp("store/0.9.2+14");
  stubFetch(() => json({ error: UPDATE }, 426));
  const e = await A.createClient(SERVER, { kind: "bearer", token: "b" })
    .get("/api/cases/c1")
    .then(() => null, (x: unknown) => x);
  assert.ok(e instanceof A.ApiError);
  assert.equal(e.status, 426);
  assert.equal(e.message, UPDATE);
  // The Store app's screens say errText(e): the sentence as sent — and a 426 is not a sign-out.
  let signedOut = false;
  const e2 = await SC.staffClient(SERVER, "b", () => (signedOut = true))
    .post("/api/cases/c1/action", { action: "reprice" })
    .then(() => null, (x: unknown) => x);
  assert.equal(SC.errText(e2), UPDATE);
  assert.equal(signedOut, false);
  // At launch (GET /api/me, the tablet's names) it is the sign-in screen's notice, not "Can't reach SwapUp — check the Wi‑Fi".
  assert.equal(SC.tooOld(e2), UPDATE);
  for (const other of [new A.ApiError(0, "Can't reach SwapUp — check the Wi‑Fi."), new A.ApiError(403, "Store turned off."), new Error("x"), null]) assert.equal(SC.tooOld(other), null);
  // The Check app's join says the server's sentence too.
  assert.equal(E.joinErrorMessage(426, "Update SwapUp Check from /downloads."), "Update SwapUp Check from /downloads.");
  A.identifyApp(null);
});
