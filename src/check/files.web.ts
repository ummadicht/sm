// Browser twin of ./files.ts: the same Store over this origin's localStorage.
//   swapup-check-install — the installId, generated once, kept across visits
//   swapup-check-state   — the current check (session, answers, results, outbox marks)
// localStorage writes are atomic per key, so no temp-file dance is needed.
// Blocked site data / private mode / quota: shared/webStorage keeps the values
// in memory for this page load and storageIsPersistent() says so, so the app
// can warn that a refresh would lose the place (results already sent are safe
// on the server).
import { webStorage } from "../shared/webStorage.web";
import { CheckState, newInstallId } from "./core";
import type { Store } from "./engine";

const INSTALL = "swapup-check-install";
const STATE = "swapup-check-state";

function readJson<T>(key: string): T | null {
  const raw = webStorage.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

let installIdCache: string | null = null;

export const fileStore: Store = {
  async load() {
    const s = readJson<CheckState>(STATE);
    return s && s.v === 1 && s.session?.id && s.code ? s : null;
  },
  async save(s) {
    if (s) webStorage.set(STATE, JSON.stringify(s));
    else webStorage.remove(STATE);
  },
  async loadInstallId() {
    if (installIdCache) return installIdCache;
    const cur = readJson<{ installId?: string }>(INSTALL);
    if (cur?.installId) return (installIdCache = cur.installId);
    const id = newInstallId();
    webStorage.set(INSTALL, JSON.stringify({ installId: id, createdAt: new Date().toISOString() }));
    return (installIdCache = id);
  },
};

/** False when the browser won't keep anything across a reload (blocked site data, some private modes). */
export function storageIsPersistent(): boolean {
  return webStorage.persistent();
}
