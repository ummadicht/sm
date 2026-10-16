// The store app keeps two things on the tablet, both in the OS keystore
// (expo-secure-store): the staff session token and the server it belongs to.
// Every call is best-effort — a keystore hiccup must never crash the counter;
// the worst case is signing in again.
import * as SecureStore from "expo-secure-store";

const K_TOKEN = "swapup_store_token";
const K_SERVER = "swapup_store_server";

async function read(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}
async function write(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* best effort */
  }
}
async function remove(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* best effort */
  }
}

export async function loadSaved(): Promise<{ server: string | null; token: string | null }> {
  const [server, token] = await Promise.all([read(K_SERVER), read(K_TOKEN)]);
  return { server, token };
}

export const saveToken = (token: string) => write(K_TOKEN, token);
export const clearToken = () => remove(K_TOKEN);
export const saveServer = (server: string) => write(K_SERVER, server);

/** "192.168.1.5:4500" → "http://192.168.1.5:4500"; trims spaces and a trailing slash. Null when it can't be a URL. */
export function normaliseServer(input: string): string | null {
  let s = input.trim().replace(/\/+$/, "");
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(s) || /^localhost(:\d+)?$/i.test(s) ? "http://" : "https://") + s;
  if (!/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(s)) return null;
  return s;
}
