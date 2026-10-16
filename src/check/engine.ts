// The check engine: join, the persistent outbox, and status polling.
//
// Every answer the customer gives is written to disk FIRST and sent second.
// The outbox is not a list of HTTP requests but a comparison: a result is
// "pending" while the `at` the server acknowledged differs from the latest
// local `at`. That makes it idempotent (the contract says latest `at` wins per
// testId), survives Wi‑Fi drops and app restarts, and a re-run simply makes the
// test pending again.
//
// No React Native imports here (only fetch via shared/api), so the same code
// runs under Node for the scratch tests. RN bindings live in check/files.ts.
import { ApiError, createClient, Client } from "../shared/api";
import {
  CheckState,
  ContractDevice,
  Declared,
  Detail,
  JoinResponse,
  Outcome,
  RemoteStatus,
  completePending,
  declarePending,
  nextAt,
  pendingResultIds,
  unsentCount,
} from "./core";

export type Store = {
  load(): Promise<CheckState | null>;
  save(s: CheckState | null): Promise<void>;
  loadInstallId(): Promise<string>;
};

export type SyncPhase = "idle" | "sending" | "sent" | "offline" | "busy" | "rejected" | "ended";

export type Snapshot = {
  ready: boolean;
  installId: string | null;
  state: CheckState | null;
  sync: { phase: SyncPhase; message: string | null; unsent: number; lastOkAt: string | null };
  remote: RemoteStatus | null;
};

export type JoinResult =
  | { ok: true; sameSession: boolean }
  | { ok: false; status: number; message: string };

type Opts = { appVersion: string; retryMs?: number; timeoutMs?: number };

/** Statuses on a device call that mean "this ticket / session isn't accepted" → re-join once. */
const AUTH_LIKE = new Set([401, 403, 404, 410]);

/** The server answered and said no (a 4xx that is not about the ticket and not "slow down"). */
function isRefusal(e: unknown): boolean {
  return e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429 && !AUTH_LIKE.has(e.status);
}

export function joinErrorMessage(status: number, serverMessage: string): string {
  // The server already speaks in plain sentences; these are fallbacks for when it doesn't.
  if (status === 0) return serverMessage + " Make sure this phone is on the store's Wi‑Fi (the advisor can show you a Wi‑Fi QR code).";
  if (status === 404 || status === 410) return /code/i.test(serverMessage) ? serverMessage : "That code is not valid any more. Ask the store for a new one.";
  if (status === 409) return /phone/i.test(serverMessage) ? serverMessage + " Ask the advisor for a new code for this phone." : "This code is already being used on another phone. Ask the advisor for a new code for this phone.";
  if (status === 429) return "Too many tries. Wait a minute, then try again.";
  if (status >= 500) return "The store's system had a problem. Wait a moment and try again — if it keeps happening, tell the advisor.";
  return serverMessage;
}

export class CheckEngine {
  private snap: Snapshot = {
    ready: false,
    installId: null,
    state: null,
    sync: { phase: "idle", message: null, unsent: 0, lastOkAt: null },
    remote: null,
  };
  private listeners = new Set<() => void>();
  private flushing: Promise<void> | null = null;
  private again = false;
  private saveChain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryMs: number;
  private timeoutMs: number;
  private failStreak = 0;
  private lastAttempt = 0;

  constructor(private store: Store, private device: () => Promise<ContractDevice>, private opts: Opts) {
    this.retryMs = opts.retryMs ?? 4000;
    this.timeoutMs = opts.timeoutMs ?? 12_000;
  }

  // ------------------------------------------------------------ subscription
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snap;
  private emit() {
    for (const l of this.listeners) l();
  }
  private patch(p: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...p };
    this.emit();
  }
  private setSync(phase: SyncPhase, message: string | null = null, lastOk?: string) {
    const st = this.snap.state;
    this.patch({
      sync: {
        phase,
        message,
        unsent: st ? unsentCount(st) : 0,
        lastOkAt: lastOk ?? this.snap.sync.lastOkAt,
      },
    });
  }
  /** Replace the persisted state: disk first (serialised writes), then listeners. */
  private commit(next: CheckState | null): Promise<void> {
    this.snap = { ...this.snap, state: next, sync: { ...this.snap.sync, unsent: next ? unsentCount(next) : 0 } };
    this.emit();
    this.saveChain = this.saveChain.then(() => this.store.save(next)).catch(() => {});
    return this.saveChain;
  }
  private update(fn: (s: CheckState) => CheckState): Promise<void> {
    const cur = this.snap.state;
    if (!cur) return Promise.resolve();
    return this.commit(fn(cur));
  }
  /** Resolves once everything committed so far is on disk. */
  persisted(): Promise<void> {
    return this.saveChain;
  }

  // ------------------------------------------------------------ lifecycle
  async init(): Promise<void> {
    const [installId, state] = await Promise.all([this.store.loadInstallId(), this.store.load().catch(() => null)]);
    this.snap = { ...this.snap, ready: true, installId, state };
    this.setSync(state?.ended ? "ended" : "idle", state?.ended ?? null);
  }

  /** Retry loop: every few seconds while something is unsent. Call stop() on teardown. */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const st = this.snap.state;
      if (!st || st.ended) return;
      if (!(unsentCount(st) > 0 || completePending(st))) return;
      // Back off gently after repeated failures (4 s → 8 s → 15 s max). A refusal
      // (the server answered "no") is retried slowly — repeating it every few
      // seconds would not change the answer.
      const wait =
        this.snap.sync.phase === "rejected"
          ? 30_000
          : Math.min(15_000, this.retryMs * Math.max(1, Math.min(4, this.failStreak)));
      if (Date.now() - this.lastAttempt < wait - 50) return;
      void this.flush();
    }, Math.max(500, Math.floor(this.retryMs / 2)));
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private client(st: CheckState): Client {
    return createClient(st.server, st.ticket ? { kind: "ticket", token: st.ticket } : null, this.timeoutMs);
  }

  // ------------------------------------------------------------ join
  async join(code: string, server: string): Promise<JoinResult> {
    const installId = this.snap.installId ?? (await this.store.loadInstallId());
    let device: ContractDevice;
    try {
      device = await this.device();
    } catch {
      device = { brand: null, manufacturer: null, modelName: null, modelCode: null, osVersion: null, totalDiskBytes: null, totalMemoryBytes: null, batteryLevelPct: null, isPhysicalDevice: true, appVersion: this.opts.appVersion };
    }
    let res: JoinResponse;
    try {
      res = await createClient(server, null, this.timeoutMs).post<JoinResponse>("/api/device/join", {
        code,
        device,
        appVersion: this.opts.appVersion,
        installId,
      });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "Can't reach SwapUp — check the Wi‑Fi or mobile data.");
      return { ok: false, status: err.status, message: joinErrorMessage(err.status, err.message) };
    }
    if (!res?.ticket || !res.session?.id) {
      return { ok: false, status: 502, message: "The store's system sent an answer this app doesn't understand. Tell the advisor (the app may need updating)." };
    }
    const session = {
      id: res.session.id,
      caseRef: res.session.caseRef ?? "",
      storeName: res.session.storeName ?? "the store",
      plan: Array.isArray(res.session.plan) ? res.session.plan.filter((p) => p && typeof p.id === "string") : [],
      server: res.session.server ?? server,
    };
    const cur = this.snap.state;
    const same = !!cur && cur.session.id === session.id;
    if (same && cur) {
      // Re-join of the same session (restart / ticket refresh): results are kept on the server and here.
      await this.commit({ ...cur, ticket: res.ticket, session, code, server, ended: null });
    } else {
      const now = new Date().toISOString();
      await this.commit({
        v: 1,
        server,
        code,
        ticket: res.ticket,
        session,
        joinedAt: now,
        consentAt: null,
        declared: null,
        declaredAt: null,
        declaredSentAt: null,
        results: {},
        acked: {},
        completeAt: null,
        completeSentAt: null,
        ended: null,
      });
      this.patch({ remote: null });
    }
    this.failStreak = 0;
    this.setSync(this.snap.state && unsentCount(this.snap.state) > 0 ? "idle" : "sent");
    void this.flush();
    return { ok: true, sameSession: same };
  }

  /** Re-join with the stored code + installId to get a fresh ticket. */
  private async rejoin(): Promise<"ok" | "offline" | "ended"> {
    const st = this.snap.state;
    if (!st) return "ended";
    const r = await this.join(st.code, st.server);
    if (r.ok) return "ok";
    if (r.status === 0 || r.status >= 500 || r.status === 429) return "offline";
    await this.update((s) => ({ ...s, ended: r.message, ticket: null }));
    return "ended";
  }

  /** Re-join quietly on app start / resume. Never throws; offline just means "use the ticket we have". */
  async refreshTicket(): Promise<void> {
    const st = this.snap.state;
    if (!st || st.ended) return;
    const r = await this.rejoin();
    if (r === "ended") this.setSync("ended", this.snap.state?.ended ?? null);
  }

  /** Forget the current check (to join a different code). The installId stays. */
  async forget(): Promise<void> {
    this.patch({ remote: null });
    await this.commit(null);
    this.setSync("idle");
  }

  // ------------------------------------------------------------ customer actions
  consent(): Promise<void> {
    return this.update((s) => ({ ...s, consentAt: s.consentAt ?? new Date().toISOString() }));
  }

  async declare(d: Declared): Promise<void> {
    await this.update((s) => ({ ...s, declared: d, declaredAt: nextAt(s.declaredAt), declareError: null }));
    void this.flush();
  }

  async record(testId: string, outcome: Outcome, detail?: Detail | null): Promise<void> {
    await this.update((s) => ({
      ...s,
      results: { ...s.results, [testId]: { outcome, detail: detail ?? null, at: nextAt(s.results[testId]?.at) } },
      // A re-run after finishing re-sends "complete" so the store's summary is recomputed.
      completeAt: s.completeAt ? nextAt(s.completeAt) : null,
    }));
    void this.flush();
  }

  async finish(): Promise<void> {
    await this.update((s) => ({ ...s, completeAt: nextAt(s.completeAt) }));
    void this.flush();
  }

  // ------------------------------------------------------------ outbox
  flush(): Promise<void> {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      do {
        this.again = false;
        await this.flushOnce();
      } while (this.again);
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushOnce(): Promise<void> {
    const st0 = this.snap.state;
    if (!st0 || st0.ended) return;
    if (!(unsentCount(st0) > 0 || completePending(st0))) {
      if (this.snap.sync.phase !== "sent") this.setSync("sent", null, this.snap.sync.lastOkAt ?? new Date().toISOString());
      return;
    }
    this.lastAttempt = Date.now();
    this.setSync("sending");
    try {
      await this.withTicket(async (client) => {
        let st = this.snap.state!;
        if (declarePending(st) && st.declared) {
          const at = st.declaredAt;
          const d = st.declared;
          try {
            await client.post("/api/device/declare", {
              screenCracked: d.screenCracked,
              backCracked: d.backCracked,
              liquid: d.liquid,
              ...(d.imei ? { imei: d.imei } : {}),
            });
            await this.update((s) => ({ ...s, declaredSentAt: at }));
          } catch (e) {
            // A refusal of the answers must not hold the test results hostage:
            // park it (shown on the summary) and carry on with the results.
            if (!isRefusal(e)) throw e;
            await this.update((s) => ({ ...s, declareError: (e as ApiError).message }));
          }
        }
        st = this.snap.state!;
        const ids = pendingResultIds(st);
        if (ids.length) {
          const batch = ids.map((id) => ({ testId: id, outcome: st.results[id].outcome, detail: st.results[id].detail, at: st.results[id].at }));
          await client.post("/api/device/results", { results: batch });
          await this.update((s) => {
            const acked = { ...s.acked };
            for (const b of batch) acked[b.testId] = b.at;
            return { ...s, acked };
          });
        }
        st = this.snap.state!;
        if (completePending(st) && pendingResultIds(st).length === 0 && !declarePending(st)) {
          const at = st.completeAt;
          await client.post("/api/device/complete", {});
          await this.update((s) => ({ ...s, completeSentAt: at }));
        }
      });
      this.failStreak = 0;
      const st = this.snap.state;
      // Something new may have arrived mid-flight; the do/while in flush() picks it up.
      if (st && (unsentCount(st) > 0 || completePending(st))) this.again = true;
      this.setSync("sent", null, new Date().toISOString());
    } catch (e) {
      this.failStreak++;
      this.classify(e);
    }
  }

  private classify(e: unknown) {
    const st = this.snap.state;
    if (st?.ended) {
      this.setSync("ended", st.ended);
      return;
    }
    const err = e instanceof ApiError ? e : new ApiError(0, "Can't reach SwapUp.");
    if (err.status === 0) this.setSync("offline", "Waiting for Wi‑Fi…");
    else if (err.status >= 500 || err.status === 429) this.setSync("busy", "The store's system didn't answer — trying again.");
    else if (/^Request failed \(\d+\)$/.test(err.message))
      this.setSync("rejected", `The store's system refused the results (error ${err.status}). Show this to the advisor — the app or the store system may need updating.`);
    else this.setSync("rejected", err.message);
  }

  /** Run `fn` with a valid ticket; on an auth-like answer, re-join once and retry. */
  private async withTicket<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    let st = this.snap.state!;
    if (!st.ticket) {
      const r = await this.rejoin();
      if (r !== "ok") throw r === "ended" ? new ApiError(410, this.snap.state?.ended ?? "This check has ended.") : new ApiError(0, "offline");
      st = this.snap.state!;
    }
    try {
      return await fn(this.client(st));
    } catch (e) {
      if (!(e instanceof ApiError) || !AUTH_LIKE.has(e.status)) throw e;
      const r = await this.rejoin();
      if (r === "ended") throw new ApiError(410, this.snap.state?.ended ?? "This check has ended.");
      if (r === "offline") throw new ApiError(0, "offline");
      return await fn(this.client(this.snap.state!));
    }
  }

  // ------------------------------------------------------------ status
  async pollStatus(): Promise<RemoteStatus | null> {
    const st = this.snap.state;
    if (!st || st.ended) return null;
    try {
      const r = await this.withTicket((c) => c.get<RemoteStatus>("/api/device/status"));
      this.patch({ remote: r });
      if (r.status === "cancelled" || r.status === "expired") {
        const msg = r.status === "cancelled" ? "The store closed this check." : "This check has timed out at the store.";
        // Only end it if nothing is left to send — otherwise keep trying and let the server say no.
        const cur = this.snap.state;
        if (cur && unsentCount(cur) === 0 && !completePending(cur)) {
          await this.update((s) => ({ ...s, ended: msg }));
          this.setSync("ended", msg);
        }
      }
      return r;
    } catch {
      return null;
    }
  }
}
