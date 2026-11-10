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
import { ApiError, createClient, type Client } from "../shared/api";
import {
  BATTERY_HEALTH_ID,
  type BatteryRec,
  type CheckState,
  type ContractDevice,
  type Declared,
  type Detail,
  type JoinResponse,
  type Outcome,
  type PairingRec,
  type PhonePhase,
  type RemoteStatus,
  type SessionInfo,
  completePending,
  declarePending,
  nextAt,
  parseIdentity,
  pendingResultIds,
  startedByCustomer,
  unsentCount,
} from "./core";

/**
 * What the Identify step adds to the declaration (swapup docs/PHONE-LED-FLOW.md). Since
 * 2026-10-17 the phone asks only "Which phone is this?" — and only when the store couldn't
 * recognise it — so a current app sends `picked` or nothing. The other keys stay for a check
 * an older app saved mid-way.
 */
export type IdentifyAnswers = Partial<Pick<Declared, "imei" | "imei2" | "identityConfirmed" | "picked" | "customerName" | "customerPhone">>;

/** A device-side call's answer, without throwing: the screens decide what each status means. */
export type DeviceCallResult<T> = { ok: true; body: T } | { ok: false; status: number; message: string };

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

/**
 * Why a check ended when the store applied the results: the session then
 * refuses writes and re-joins, but the store HAS the results — this is the
 * customer's finish line, not an error ("that code is not valid any more").
 */
export const APPLIED_MESSAGE = "The advisor has put your results on your trade-in. Nothing more to do on this phone.";

/** Statuses on a device call that mean "this ticket / session isn't accepted" → re-join once. */
const AUTH_LIKE = new Set([401, 403, 404, 410]);

/** The server answered and said no (a 4xx that is not about the ticket and not "slow down"). */
function isRefusal(e: unknown): boolean {
  return e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429 && !AUTH_LIKE.has(e.status);
}

/** A sentence the server wrote for a person — not empty, not an HTTP status line or a stack. */
function plainSentence(m: string): boolean {
  const t = m.trim();
  return t.length >= 8 && t.length <= 200 && /[a-z]/i.test(t) && !/^(HTTP\b|\d{3}\b|error\b|\{|<)/i.test(t) && !/\bat \S+:\d+/.test(t);
}

export function joinErrorMessage(status: number, serverMessage: string): string {
  // The server already speaks in plain sentences ("Check done at … — ask the advisor for another.",
  // "This check has ended — scan the store's QR to start again.") and they are shown as sent;
  // these are only fallbacks for an empty or opaque answer.
  if (status === 0) return serverMessage;
  if (status >= 500) return "Store system problem — try again in a moment.";
  if (plainSentence(serverMessage)) return serverMessage.trim();
  if (status === 404 || status === 410) return "That code has expired — ask for a new one.";
  if (status === 409) return "Code in use on another phone — ask for a new one.";
  if (status === 429) return "Too many tries — wait a minute.";
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

  private store: Store;
  private device: () => Promise<ContractDevice>;
  private opts: Opts;

  // Plain fields, not constructor parameter properties: node's strip-only TypeScript (the unit
  // tests, ./engine.test.ts) can't run those.
  constructor(store: Store, device: () => Promise<ContractDevice>, opts: Opts) {
    this.store = store;
    this.device = device;
    this.opts = opts;
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
      // The store's tablet shows where the phone is; a phase that didn't get through is re-sent now and then.
      if (this.phase?.state === "pending" && Date.now() - this.phase.triedAt > 8000) void this.sendPhase();
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
  /** `resume`: the app re-joining by itself — the server then only hands back this phone's OWN open check, never a new one. */
  async join(code: string, server: string, opts: { resume?: boolean } = {}): Promise<JoinResult> {
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
        ...(opts.resume ? { resume: true } : {}),
      });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "Can't reach SwapUp — check the Wi‑Fi.");
      return { ok: false, status: err.status, message: joinErrorMessage(err.status, err.message) };
    }
    if (!res?.ticket || !res.session?.id) {
      return { ok: false, status: 502, message: "Unexpected answer — tell the advisor." };
    }
    const raw = res.session as unknown as Record<string, unknown>;
    const session: SessionInfo = {
      id: res.session.id,
      caseRef: res.session.caseRef ?? "",
      storeName: res.session.storeName ?? "the store",
      plan: Array.isArray(res.session.plan) ? res.session.plan.filter((p) => p && typeof p.id === "string") : [],
      server: res.session.server ?? server,
      // Phone-led flow (PHONE-LED-FLOW.md): what the server matched from the model
      // code, and whether the customer started this from the counter code.
      identity: parseIdentity(raw.identity),
      customerStarted: startedByCustomer(raw),
    };
    // What this phone called itself — the picker's "couldn't tell the exact model from its code (…)".
    // The code only: a browser on an iPhone has none, and "iPhone" is not one. `measured`:
    // it read its own storage, which the store always takes over anything the customer says.
    const reported = { brand: device.brand, modelCode: device.modelCode, measured: typeof device.totalDiskBytes === "number" && device.totalDiskBytes > 0 };
    const cur = this.snap.state;
    const same = !!cur && cur.session.id === session.id;
    if (same && cur) {
      // Re-join of the same session (restart / ticket refresh): results are kept on the server and here.
      await this.commit({ ...cur, ticket: res.ticket, session, code, server, ended: null, reported });
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
        pairing: null,
        identifiedAt: null,
        battery: null,
        reported,
      });
      this.phase = null; // a new session: its first phase must be sent even if it matches the last one's
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
    const r = await this.join(st.code, st.server, { resume: true });
    if (r.ok) return "ok";
    if (r.status === 0 || r.status >= 500 || r.status === 429) return "offline";
    // Refused. If the store applied the results (mid-run, or while this page was
    // closed), the old ticket can still read the status — say so instead of
    // "that code is not valid any more". The ticket is kept for status reads.
    if (st.ticket) {
      try {
        const s = await this.client(st).get<RemoteStatus>("/api/device/status");
        if (s?.status === "applied") {
          this.patch({ remote: s });
          await this.update((x) => ({ ...x, ended: APPLIED_MESSAGE }));
          return "ended";
        }
      } catch {
        /* fall through to the join's own answer */
      }
    }
    await this.update((s) => ({ ...s, ended: r.message, ticket: null }));
    return "ended";
  }

  /**
   * If GET /api/device/status carries a newer `identity` (e.g. the advisor saved the IMEI on the
   * case after the phone joined, SUP-258), update `session.identity` on disk and notify listeners.
   */
  private async syncIdentity(rawIdentity: unknown): Promise<void> {
    if (rawIdentity === undefined) return;
    const next = parseIdentity(rawIdentity);
    const cur = this.snap.state;
    if (!next || !cur) return;
    const prev = cur.session.identity ?? null;
    if (
      prev &&
      prev.match === next.match &&
      prev.label === next.label &&
      prev.variant === next.variant &&
      prev.modelId === next.modelId &&
      prev.reason === next.reason &&
      prev.variants.join("|") === next.variants.join("|")
    ) {
      return;
    }
    await this.update((s) => ({ ...s, session: { ...s.session, identity: next } }));
  }

  /**
   * On app start / resume. The ticket we have is checked FIRST and kept while it
   * works — re-joining rotates it, and a resume is often just the photo picker
   * returning mid-upload (the battery screenshot). Only a refused ticket re-joins.
   * Never throws; offline just means "use the ticket we have".
   */
  async refreshTicket(): Promise<void> {
    const st = this.snap.state;
    if (!st || st.ended) return;
    if (st.ticket) {
      try {
        const s = await this.client(st).get<RemoteStatus>("/api/device/status");
        await this.syncIdentity(s?.identity);
        if (s?.status === "applied") {
          this.patch({ remote: s });
          await this.update((x) => ({ ...x, ended: APPLIED_MESSAGE }));
          this.setSync("ended", APPLIED_MESSAGE);
        }
        return; // the ticket still works
      } catch (e) {
        if (!(e instanceof ApiError) || !AUTH_LIKE.has(e.status)) return; // offline / busy: keep it
      }
    }
    const r = await this.rejoin();
    if (r === "ended") this.setSync("ended", this.snap.state?.ended ?? null);
  }

  /**
   * The "store has your results" screen after a restart: the status — and with it the
   * report link and the grade — is kept in memory only, so read it once more with the
   * ticket kept for status reads. Nothing to do once it is known. Never throws: offline,
   * or a ticket that is gone, just means the screen shows no link.
   */
  async readAppliedStatus(opts: { again?: boolean } = {}): Promise<void> {
    const st = this.snap.state;
    // `again`: read even with the status in memory — a newer report version moves the grade.
    if (!st || st.ended !== APPLIED_MESSAGE || !st.ticket || (this.snap.remote && !opts.again)) return;
    try {
      const s = await this.client(st).get<RemoteStatus>("/api/device/status");
      if (s?.status === "applied" && this.snap.state?.ticket === st.ticket) this.patch({ remote: s }); // still the same check
    } catch {
      /* no link this time */
    }
  }

  /** Forget the current check (to join a different code). The installId stays. */
  async forget(): Promise<void> {
    this.phase = null;
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

  /**
   * The Identify step is finished: its answer (the model the customer chose) joins the
   * declaration, sent with the outbox, and the step is marked done in the same write, so a
   * restart never asks twice or loses it. Nothing chosen ("Ask the advisor") sends
   * nothing — there is no answer to send.
   */
  async identify(a: IdentifyAnswers): Promise<void> {
    const said = Object.values(a).some((v) => v !== null && v !== undefined);
    await this.update((s) => {
      const identifiedAt = s.identifiedAt ?? new Date().toISOString();
      if (!said) return { ...s, identifiedAt };
      const base: Declared = s.declared ?? { screenCracked: null, backCracked: null, liquid: null, imei: null };
      return { ...s, declared: { ...base, ...a }, declaredAt: nextAt(s.declaredAt), declareError: null, identifiedAt };
    });
    if (said) void this.flush();
  }

  /** The Scan screen is over (kept on disk so a restart doesn't pair again). */
  setPairing(p: PairingRec): Promise<void> {
    return this.update((s) => ({ ...s, pairing: p }));
  }

  /**
   * The battery screenshot step is over (kept on disk). A screenshot that was
   * sent has its result on the server already — read or unreadable. One that
   * never was (Skip) is said so on battery_health, so it is "not tested" with a
   * reason rather than missing.
   */
  async setBattery(b: BatteryRec): Promise<void> {
    await this.update((s) => ({ ...s, battery: b }));
    const st = this.snap.state;
    if (b.outcome === "skipped" && st && st.session.plan.some((p) => p.id === BATTERY_HEALTH_ID) && !st.results[BATTERY_HEALTH_ID]) {
      await this.record(BATTERY_HEALTH_ID, "skip", { method: "battery screenshot", reason: "the customer skipped the battery screenshot" });
    }
  }

  // ------------------------------------------------------------ device calls outside the outbox
  //
  // The Scan screen (GET/POST /api/device/screen — SwapUp's proxy of GradeIQ's
  // /screen, every ~700 ms), the camera link, the model picker, the battery
  // screenshot and the phase. They deliberately do NOT go through withTicket():
  // a 404 there means "re-join", and a server without one of these routes (an
  // older server, or a check without camera grading) would re-join twice a
  // second. Only 401/403 refresh the ticket here, at most every 20 s. Each
  // screen reads the status itself (404 = this server hasn't got it).
  private lastScreenRefresh = 0;

  private async deviceCall<T>(fn: (c: Client) => Promise<T>, timeoutMs = 8000): Promise<DeviceCallResult<T>> {
    const st = this.snap.state;
    if (!st || st.ended || !st.ticket) return { ok: false, status: 0, message: "not connected" };
    try {
      return { ok: true, body: await fn(createClient(st.server, { kind: "ticket", token: st.ticket }, timeoutMs)) };
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "Can't reach SwapUp.");
      if ((err.status === 401 || err.status === 403) && Date.now() - this.lastScreenRefresh > 20_000) {
        this.lastScreenRefresh = Date.now();
        await this.refreshTicket().catch(() => {});
      }
      return { ok: false, status: err.status, message: err.message };
    }
  }

  /** What the store's camera wants this screen to show. */
  screenPoll() {
    return this.deviceCall((c) => c.get<unknown>("/api/device/screen"));
  }

  /** Tell the camera which pattern this screen is ACTUALLY showing now. */
  screenShown(shown: string) {
    return this.deviceCall((c) => c.post<unknown>("/api/device/screen", { shown }));
  }

  /** GET /api/device/camera-link → { url } for the Scan screen's QR. 409 = GradeIQ not ready yet (ask again). */
  cameraLink() {
    return this.deviceCall((c) => c.get<unknown>("/api/device/camera-link"));
  }

  /** The Identify picker: no brand → { brands }, a brand → { models }. No prices. */
  deviceModels(brand?: string) {
    return this.deviceCall((c) => c.get<unknown>("/api/device/models" + (brand ? `?brand=${encodeURIComponent(brand)}` : "")), 12_000);
  }

  /**
   * POST /api/device/battery { image } — the server forwards the screenshot to
   * GradeIQ's reader (a vision model), so this waits much longer than a poll.
   */
  sendBattery(image: string) {
    return this.deviceCall((c) => c.post<unknown>("/api/device/battery", { image }), 45_000);
  }

  // ------------------------------------------------------------ phase (where the phone is, for the store's tablet)
  private phase: { want: PhonePhase; state: "pending" | "sent" | "refused"; triedAt: number } | null = null;

  /**
   * POST /api/device/phase { phase } on each step change. Fire-and-forget: a
   * phase that doesn't get through is re-sent by the retry loop; an older server
   * without the route (a 4xx) is not asked again for that phase.
   */
  reportPhase(phase: PhonePhase): void {
    if (this.phase?.want === phase) return;
    this.phase = { want: phase, state: "pending", triedAt: 0 };
    void this.sendPhase();
  }

  private async sendPhase(): Promise<void> {
    const p = this.phase;
    if (!p || p.state !== "pending") return;
    p.triedAt = Date.now();
    const r = await this.deviceCall((c) => c.post<unknown>("/api/device/phase", { phase: p.want }));
    if (this.phase !== p) return; // a newer phase took over meanwhile
    if (r.ok) p.state = "sent";
    else if (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403 && r.status !== 429) p.state = "refused";
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
              // The Identify step's answers (an older server ignores them).
              ...(d.imei2 ? { imei2: d.imei2 } : {}),
              ...(d.identityConfirmed !== undefined ? { identityConfirmed: d.identityConfirmed } : {}),
              ...(d.picked !== undefined ? { picked: d.picked } : {}),
              ...(d.customerName ? { customerName: d.customerName } : {}),
              ...(d.customerPhone ? { customerPhone: d.customerPhone } : {}),
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
    else if (err.status >= 500 || err.status === 429) this.setSync("busy", "No answer from the store — retrying.");
    else if (/^Request failed \(\d+\)$/.test(err.message)) this.setSync("rejected", `Results refused (error ${err.status}) — tell the advisor.`);
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
      await this.syncIdentity(r?.identity);
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
