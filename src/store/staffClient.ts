import { ApiError, type CallOptions, createClient } from "../shared/api";

/**
 * The shared client with the staff Bearer token, plus one rule: any 401 means
 * the 12-hour session is over, so the app goes back to sign-in.
 */
export function staffClient(server: string, token: string, onUnauthorized: () => void) {
  const c = createClient(server, { kind: "bearer", token });
  const guard = <T,>(p: Promise<T>): Promise<T> =>
    p.catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
      throw e;
    });
  return {
    base: c.base,
    get: <T,>(path: string) => guard(c.get<T>(path)),
    post: <T,>(path: string, body?: unknown, opts?: CallOptions) => guard(c.post<T>(path, body, opts)),
    patch: <T,>(path: string, body: unknown, opts?: CallOptions) => guard(c.patch<T>(path, body, opts)),
  };
}

export type StaffClient = ReturnType<typeof staffClient>;

export function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong. Try again.";
}

/** Server URLs may come back relative ("/api/auth/handoff/…"). */
export function absolute(base: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return base.replace(/\/$/, "") + (url.startsWith("/") ? url : `/${url}`);
}
