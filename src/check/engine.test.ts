// node --test --experimental-strip-types --no-warnings src/check/engine.test.ts
// The "store has your results" screen after a restart (grading spec §5, Check app): the status —
// the report link and the grade — lives in memory only, so the engine reads it once more with the
// ticket it kept for status reads. engine.ts imports its siblings without an extension (Metro's
// way); a resolve hook adds ".ts" so plain node can load it. No React Native in engine.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); }
        catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]sx?$/.test(s)) return next(s + ".ts", c); throw e; }
      }`
    )
);

const E: typeof import("./engine") = await import("./engine" + ".ts");
const R: typeof import("./report") = await import("./report" + ".ts");

const SERVER = "https://swapup.example.in";
const STATUS = {
  status: "applied",
  caseRef: "SU-AND-00120",
  reportPath: "/r/AbC123_-xyz",
  grading: { status: "graded", label: "Good (B)", grade: "Good", letter: "B", final: true },
};

type Call = { url: string; auth: string | null };
function stubFetch(answer: () => Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), auth: h.authorization ?? null });
    return answer();
  }) as typeof fetch;
  return calls;
}
const json = (x: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } }));

/** An engine restarted on the ended screen: the saved check, as the disk has it. */
async function restarted(over: Record<string, unknown> = {}) {
  const saved = {
    v: 1,
    server: SERVER,
    code: "123456",
    ticket: "tkt_0123456789abcdefghij",
    session: {},
    joinedAt: "2026-10-17T10:00:00.000Z",
    consentAt: "2026-10-17T10:00:05.000Z",
    declared: null,
    declaredSentAt: null,
    declaredAt: null,
    results: {},
    acked: {},
    completeAt: "2026-10-17T10:09:00.000Z",
    completeSentAt: "2026-10-17T10:09:00.000Z",
    ended: E.APPLIED_MESSAGE,
    ...over,
  };
  const store = { load: async () => saved as never, save: async () => {}, loadInstallId: async () => "install-1" };
  const engine = new E.CheckEngine(store, async () => ({}) as never, { appVersion: "0.7.0" });
  await engine.init();
  return engine;
}

test("readAppliedStatus: after a restart on the applied screen, the report link and the grade come back", async () => {
  const calls = stubFetch(() => json(STATUS));
  const engine = await restarted();
  assert.equal(engine.getSnapshot().remote, null);
  await engine.readAppliedStatus();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${SERVER}/api/device/status`);
  assert.equal(calls[0].auth, "Ticket tkt_0123456789abcdefghij");
  const snap = engine.getSnapshot();
  assert.deepEqual(R.customerReport(snap.remote, snap.state!.server), { url: `${SERVER}/r/AbC123_-xyz`, grade: "Good (B)" });
  // Known now: no second call.
  await engine.readAppliedStatus();
  assert.equal(calls.length, 1);
  // …unless asked again (the screen's slow re-read): a newer report version moves the grade.
  stubFetch(() => json({ ...STATUS, grading: { ...STATUS.grading, label: "Superb (A)" } }));
  await engine.readAppliedStatus({ again: true });
  assert.equal((engine.getSnapshot().remote as { grading?: { label?: string } } | null)?.grading?.label, "Superb (A)");
});

test("readAppliedStatus: nothing to read on any other ended screen, or without the ticket", async () => {
  const calls = stubFetch(() => json(STATUS));
  await (await restarted({ ended: "The store closed this check." })).readAppliedStatus();
  await (await restarted({ ticket: null })).readAppliedStatus();
  await (await restarted({ ended: null })).readAppliedStatus();
  assert.equal(calls.length, 0);
});

test("readAppliedStatus: offline, a ticket that is gone, or a status that isn't applied — no link, and it never throws", async () => {
  for (const answer of [() => Promise.reject(new TypeError("network down")), () => json({ error: "This phone is not connected to a store session." }, 401), () => json({ ...STATUS, status: "closed" })]) {
    stubFetch(answer);
    const engine = await restarted();
    await engine.readAppliedStatus();
    assert.equal(engine.getSnapshot().remote, null);
  }
});

test("identify: 'Leave it to the advisor' sends nothing; a picked model is the only answer sent", async () => {
  const posts: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") posts.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const open = { ended: null, completeAt: null, completeSentAt: null };
  const left = await restarted(open);
  await left.identify({});
  await left.flush();
  assert.ok(left.getSnapshot().state?.identifiedAt, "the step is behind the phone");
  assert.equal(left.getSnapshot().state?.declared, null, "no declaration — nothing was asked, nothing is claimed");
  assert.equal(posts.filter((p) => p.url.endsWith("/api/device/declare")).length, 0);

  const picked = await restarted(open);
  await picked.identify({ picked: { modelId: "galaxy-a54", variant: null } });
  await picked.flush();
  const sent = posts.filter((p) => p.url.endsWith("/api/device/declare"));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body, { screenCracked: null, backCracked: null, liquid: null, picked: { modelId: "galaxy-a54", variant: null } }, "no damage answers, no IMEI, no confirm, no contact");
});

test("joinErrorMessage: every join refusal the server sends is shown as it wrote it; the fallbacks are for an empty or opaque answer", () => {
  // swapup lib/server/testSessions.ts — each join refusal, word for word.
  const server: [number, string][] = [
    [404, "That code has expired — ask the store for a new one."],
    [409, "This code is in use on another phone — ask for a new one."],
    [409, "Check done at Andheri West Experience Center — ask the advisor for another."],
    [410, "This check has ended — scan the store's QR to start again."],
    [429, "Too many new checks — ask the advisor for a code."],
    [400, "The app did not send its install id — update SwapUp Check."],
  ];
  for (const [status, said] of server) assert.equal(E.joinErrorMessage(status, said), said, `${status}: ${said}`);
  assert.equal(E.joinErrorMessage(404, ""), "That code has expired — ask for a new one.");
  assert.equal(E.joinErrorMessage(409, "HTTP 409"), "Code in use on another phone — ask for a new one.");
  assert.equal(E.joinErrorMessage(429, ""), "Too many tries — wait a minute.");
  assert.equal(E.joinErrorMessage(502, "<html>Bad gateway</html>"), "Store system problem — try again in a moment.");
  assert.equal(E.joinErrorMessage(0, "No connection — check the Wi-Fi."), "No connection — check the Wi-Fi.");
});
