// The store app keeps two things on the tablet: the staff session token and the
// server it belongs to. Native: the OS keystore (expo-secure-store, see
// ./keystore.ts); browser: this origin's localStorage (./keystore.web.ts).
// Every call is best-effort — a keystore hiccup must never crash the counter;
// the worst case is signing in again.
import { read, remove, write } from "./keystore";

const K_TOKEN = "swapup_store_token";
const K_SERVER = "swapup_store_server";
const K_EXPIRES = "swapup_store_expires";

export async function loadSaved(): Promise<{ server: string | null; token: string | null; expiresAt: string | null }> {
  const [server, token, expiresAt] = await Promise.all([read(K_SERVER), read(K_TOKEN), read(K_EXPIRES)]);
  return { server, token, expiresAt };
}

export async function saveToken(token: string, expiresAt?: string | null): Promise<void> {
  await write(K_TOKEN, token);
  if (expiresAt) await write(K_EXPIRES, expiresAt);
  else await remove(K_EXPIRES);
}
export async function clearToken(): Promise<void> {
  await Promise.all([remove(K_TOKEN), remove(K_EXPIRES)]);
}
export const saveServer = (server: string) => write(K_SERVER, server);

/** "192.168.1.5:4500" → "http://192.168.1.5:4500"; trims spaces and a trailing slash. Null when it can't be a URL. */
export function normaliseServer(input: string): string | null {
  let s = input.trim().replace(/\/+$/, "");
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(s) || /^localhost(:\d+)?$/i.test(s) ? "http://" : "https://") + s;
  if (!/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(s)) return null;
  return s;
}
