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
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * A browser must never answer a GET from its HTTP cache (the answer on the Check app's result
 * screen moves while the advisor works). The server already says no-store; this is the browser's
 * half. Not on native: React Native's fetch polyfill turns `cache: "no-store"` into an extra
 * `?_=<time>` on the URL, and the app keeps no HTTP cache to skip.
 */
const NO_STORE: { cache?: "no-store" } = typeof document !== "undefined" ? { cache: "no-store" } : {};

export function createClient(server: string, auth: Auth, timeoutMs = 15_000) {
  const base = server.replace(/\/$/, "");
  async function call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(base + path, {
        method,
        signal: ctrl.signal,
        ...(method === "GET" ? NO_STORE : {}),
        headers: {
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(auth ? { authorization: `${SCHEME[auth.kind]} ${auth.token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        /* empty */
      }
      if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error || `Request failed (${res.status})`);
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
    post: <T>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
    /** Partial update (e.g. PATCH /api/cases/<id>); the server answers with the whole record. */
    patch: <T>(path: string, body: unknown) => call<T>("PATCH", path, body ?? {}),
  };
}

export type Client = ReturnType<typeof createClient>;
