// Tiny JSON persistence on the app's document directory: settings + the last
// 50 sessions, so a desk can re-share a report after the fact.
import * as FS from "expo-file-system/legacy";
import { DEFAULT_SETTINGS, Session, Settings } from "./types";

const dir = FS.documentDirectory ?? FS.cacheDirectory ?? "";
const SETTINGS = dir + "gradeiq-settings.json";
const SESSIONS = dir + "gradeiq-sessions.json";

async function readJson<T>(uri: string, fallback: T): Promise<T> {
  try {
    const info = await FS.getInfoAsync(uri);
    if (!info.exists) return fallback;
    return JSON.parse(await FS.readAsStringAsync(uri)) as T;
  } catch {
    return fallback;
  }
}
async function writeJson(uri: string, v: unknown) {
  try { await FS.writeAsStringAsync(uri, JSON.stringify(v)); } catch { /* best effort */ }
}

export const loadSettings = () => readJson<Settings>(SETTINGS, DEFAULT_SETTINGS).then((s) => ({ ...DEFAULT_SETTINGS, ...s }));
export const saveSettings = (s: Settings) => writeJson(SETTINGS, s);

export const loadSessions = () => readJson<Session[]>(SESSIONS, []);
export async function saveSession(s: Session) {
  const all = await loadSessions();
  const next = [s, ...all.filter((x) => x.id !== s.id)].slice(0, 50);
  await writeJson(SESSIONS, next);
}

/** Write a report JSON to the cache dir and return its file:// URI (for Sharing). */
export async function writeReportFile(name: string, json: unknown): Promise<string> {
  const uri = (FS.cacheDirectory ?? dir) + name;
  await FS.writeAsStringAsync(uri, JSON.stringify(json, null, 2));
  return uri;
}

export function newId(): string {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
