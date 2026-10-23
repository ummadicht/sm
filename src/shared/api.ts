// The one HTTP client both apps use. JSON in/out, a hard timeout (a phone on
// flaky store Wi‑Fi must never hang a screen), and the server's own sentence
// as the error message.

// bearer = a person's 12-hour staff session; ticket = the Check app's test
// session; device = a store tablet's long-lived token, which can only list the
// store's staff and unlock one of them by PIN (never Bearer — the server's
// session check must keep ignoring it).
export type Auth = { kind: "bearer" | "ticket" | "device"; token: string } | null;

const SCHEME: Record<NonNullable<Auth>["kind"], string> = { bearer: "Bearer", ticket: "Ticket", device: "Device" };

export class ApiError extends Error {
  status: number;
  /** The server's machine word for the refusal, when it sends one (e.g. "blacklisted", "reader_off"). */
  reason: string | null;
  constructor(status: number, message: string, reason: string | null = null) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

/**
 * Which app and build is calling, sent on EVERY call: `X-SwapUp-App: store/0.9.3+15` — the app
 * (store | check), its version and its Android versionCode, as the build's own config says
 * (./config works it out once, at start-up; the browser build carries the same values, inlined
 * at export). The apps are sideloaded with no over-the-air updates, so this is how the server
 * spots an old build: it refuses it with HTTP 426 and one sentence ("Update SwapUp Store from
 * /downloads."), which the screens show like any refusal — the server's words, as sent.
 */
export const APP_HEADER = "x-swapup-app";

/**
 * "store/0.9.3+15", or null when the build doesn't know its version or versionCode (then no
 * header is sent — the server reads that as an unversioned build; a value is never made up).
 */
export function appIdOf(app: string, version: string | null | undefined, versionCode: unknown): string | null {
  const code = typeof versionCode === "number" ? versionCode : typeof versionCode === "string" && /^\d+$/.test(versionCode) ? Number(versionCode) : NaN;
  if (app !== "store" && app !== "check") return null;
  if (typeof version !== "string" || !/^\d+(\.\d+)*$/.test(version) || !Number.isInteger(code) || code <= 0) return null;
  return `${app}/${version}+${code}`;
}

let appId: string | null = null;
/** Set once by ./config as the app starts (App.tsx loads it before anything calls the server). */
export function identifyApp(id: string | null): void {
  appId = id;
}

/** Per call: a longer wait for a call the server itself waits on (reading an IMEI off a photo). */
export type CallOptions = { timeoutMs?: number };

/**
 * A browser must never answer a GET from its HTTP cache (the answer on the Check app's result
 * screen moves while the advisor works). The server already says no-store; this is the browser's
 * half. Not on native: React Native's fetch polyfill turns `cache: "no-store"` into an extra
 * `?_=<time>` on the URL, and the app keeps no HTTP cache to skip.
 */
const NO_STORE: { cache?: "no-store" } = typeof document !== "undefined" ? { cache: "no-store" } : {};

export function createClient(server: string, auth: Auth, timeoutMs = 15_000) {
  const base = server.replace(/\/$/, "");
  async function call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, opts?: CallOptions): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? timeoutMs);
    try {
      const res = await fetch(base + path, {
        method,
        signal: ctrl.signal,
        ...(method === "GET" ? NO_STORE : {}),
        headers: {
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(auth ? { authorization: `${SCHEME[auth.kind]} ${auth.token}` } : {}),
          ...(appId ? { [APP_HEADER]: appId } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        /* empty */
      }
      if (!res.ok) {
        const d = data as { error?: unknown; reason?: unknown } | null;
        throw new ApiError(res.status, (typeof d?.error === "string" && d.error) || `Request failed (${res.status})`, typeof d?.reason === "string" ? d.reason : null);
      }
      return data as T;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if ((e as Error).name === "AbortError") throw new ApiError(0, "No answer — check the Wi‑Fi.");
      throw new ApiError(0, "Can't reach SwapUp — check the Wi‑Fi.");
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    base,
    get: <T>(path: string) => call<T>("GET", path),
    post: <T>(path: string, body?: unknown, opts?: CallOptions) => call<T>("POST", path, body ?? {}, opts),
    /** Partial update (e.g. PATCH /api/cases/<id>); the server answers with the whole record. */
    patch: <T>(path: string, body: unknown, opts?: CallOptions) => call<T>("PATCH", path, body ?? {}, opts),
  };
}

export type Client = ReturnType<typeof createClient>;
