// On-disk persistence for SwapUp Check (expo-file-system/legacy, app-private
// document directory). Two files:
//   swapup-check-install.json — the installId, generated once, never reset
//   swapup-check-state.json   — the current check (session, answers, results, outbox marks)
// Writes go to a temp file and are then moved over the real one, so a phone
// that dies mid-write keeps the previous good copy instead of a torn file.
import * as FS from "expo-file-system/legacy";
import { CheckState, newInstallId } from "./core";
import type { Store } from "./engine";

const dir = FS.documentDirectory ?? FS.cacheDirectory ?? "";
const INSTALL = dir + "swapup-check-install.json";
const STATE = dir + "swapup-check-state.json";

async function readJson<T>(uri: string): Promise<T | null> {
  try {
    const info = await FS.getInfoAsync(uri);
    if (!info.exists) return null;
    return JSON.parse(await FS.readAsStringAsync(uri)) as T;
  } catch {
    return null;
  }
}

async function writeJson(uri: string, v: unknown): Promise<void> {
  const tmp = uri + ".tmp";
  await FS.writeAsStringAsync(tmp, JSON.stringify(v));
  await FS.deleteAsync(uri, { idempotent: true });
  await FS.moveAsync({ from: tmp, to: uri });
}

let installIdCache: string | null = null;

export const fileStore: Store = {
  async load() {
    const s = await readJson<CheckState>(STATE);
    if (!s || s.v !== 1 || !s.session?.id || !s.code) {
      // A torn final write leaves the temp copy behind — use it if it's whole.
      const t = await readJson<CheckState>(STATE + ".tmp");
      return t && t.v === 1 && t.session?.id ? t : null;
    }
    return s;
  },
  async save(s) {
    try {
      if (s) await writeJson(STATE, s);
      else {
        await FS.deleteAsync(STATE, { idempotent: true });
        await FS.deleteAsync(STATE + ".tmp", { idempotent: true });
      }
    } catch {
      /* disk full / revoked: the in-memory copy still drives this run */
    }
  },
  async loadInstallId() {
    if (installIdCache) return installIdCache;
    const cur = await readJson<{ installId?: string }>(INSTALL);
    if (cur?.installId) return (installIdCache = cur.installId);
    const id = newInstallId();
    try {
      await writeJson(INSTALL, { installId: id, createdAt: new Date().toISOString() });
    } catch {
      /* still usable for this run */
    }
    return (installIdCache = id);
  },
};

/** The app's document directory always survives a restart (the browser twin can't promise that). */
export function storageIsPersistent(): boolean {
  return true;
}
