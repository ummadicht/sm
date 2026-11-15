// The store app keeps a few things on the tablet: the staff session token and
// the server it belongs to — or, on a store tablet, the long-lived device token
// (plus a cached name so the Offline screen can say whose tablet it is). In
// tablet mode the staff token is never saved: it lives in memory only, so a
// restart always comes back to "Who's serving?".
// Native: the OS keystore (expo-secure-store, see ./keystore.ts); browser: this
// origin's localStorage (./keystore.web.ts).
// Every call is best-effort — a keystore hiccup must never crash the counter;
// the worst case is signing in again.
import { persistent, read, remove, write } from "./keystore";

/** Whether this device keeps what is saved past a restart / reload — a store tablet's key must survive. */
export const canKeepDevice = persistent;

const K_TOKEN = "swapup_store_token";
const K_SERVER = "swapup_store_server";
const K_EXPIRES = "swapup_store_expires";
// Key names are from docs/STORE-TABLET.md (expo-secure-store allows dots).
const K_DEVICE = "swapup.store.device";
const K_DEVICE_INFO = "swapup.store.deviceInfo";

/** What the tablet remembers about itself between launches (the server stays the source of truth). */
export type DeviceInfo = { deviceId: string; deviceName: string; storeName: string };

export type Saved = {
  server: string | null;
  token: string | null;
  expiresAt: string | null;
  /** Set when this device is a store tablet. */
  deviceToken: string | null;
  deviceInfo: DeviceInfo | null;
};

function parseDeviceInfo(raw: string | null): DeviceInfo | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<DeviceInfo> | null;
    if (!o || typeof o.deviceId !== "string") return null;
    return { deviceId: o.deviceId, deviceName: typeof o.deviceName === "string" ? o.deviceName : "", storeName: typeof o.storeName === "string" ? o.storeName : "" };
  } catch {
    return null;
  }
}

export async function loadSaved(): Promise<Saved> {
  const [server, token, expiresAt, deviceToken, info] = await Promise.all([
    read(K_SERVER),
    read(K_TOKEN),
    read(K_EXPIRES),
    read(K_DEVICE),
    read(K_DEVICE_INFO),
  ]);
  return { server, token, expiresAt, deviceToken, deviceInfo: parseDeviceInfo(info) };
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

/** This device becomes (or stays) the store tablet. The token is shown once by the server — this is its only copy. */
export async function saveDevice(deviceToken: string, info: DeviceInfo): Promise<void> {
  await Promise.all([write(K_DEVICE, deviceToken), saveDeviceInfo(info)]);
}
/** Refresh the cached names (a manager may rename the store or the tablet). */
export const saveDeviceInfo = (info: DeviceInfo) => write(K_DEVICE_INFO, JSON.stringify(info));
export async function clearDevice(): Promise<void> {
  await Promise.all([remove(K_DEVICE), remove(K_DEVICE_INFO)]);
}

/** "192.168.1.5:4500" → "http://192.168.1.5:4500"; trims spaces and a trailing slash. Null when it can't be a URL. */
export function normaliseServer(input: string): string | null {
  let s = input.trim().replace(/\/+$/, "");
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(s) || /^localhost(:\d+)?$/i.test(s) ? "http://" : "https://") + s;
  if (!/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(s)) return null;
  return s;
}

const K_HOTSPOT = "swapup.store.hotspot";

export type SavedHotspot = {
  ssid: string;
  password: string;
  security: "WPA" | "WEP" | "nopass";
  hidden: boolean;
};

export async function loadHotspot(): Promise<SavedHotspot | null> {
  const raw = await read(K_HOTSPOT);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<SavedHotspot> | null;
    if (!o || typeof o.ssid !== "string" || !o.ssid.trim()) return null;
    const sec = o.security === "WEP" || o.security === "nopass" ? o.security : "WPA";
    return {
      ssid: o.ssid.trim(),
      password: typeof o.password === "string" ? o.password : "",
      security: sec,
      hidden: !!o.hidden,
    };
  } catch {
    return null;
  }
}

export async function saveHotspot(cfg: SavedHotspot | null): Promise<void> {
  if (!cfg || !cfg.ssid.trim()) {
    await remove(K_HOTSPOT);
    return;
  }
  await write(K_HOTSPOT, JSON.stringify(cfg));
}

