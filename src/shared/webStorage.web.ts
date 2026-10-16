// localStorage for the browser builds, with the failures a browser can throw:
// blocked site data (SecurityError on access), quota exceeded, storage cleared
// under us. Every write also lands in memory, so the page keeps working for
// this load even when nothing can be saved; `persistent()` says which it is.
const memory = new Map<string, string>();
let ls: Storage | null | undefined;

function storage(): Storage | null {
  if (ls !== undefined) return ls;
  try {
    const s = window.localStorage;
    const probe = "__swapup_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    ls = s;
  } catch {
    ls = null;
  }
  return ls;
}

export const webStorage = {
  get(key: string): string | null {
    // Memory holds the newest value written in this page load (it also covers a
    // quota failure, where localStorage still has the older copy).
    if (memory.has(key)) return memory.get(key) ?? null;
    const s = storage();
    if (!s) return null;
    try {
      return s.getItem(key);
    } catch {
      return null;
    }
  },
  /** False when the value only lives in memory (blocked storage, quota). */
  set(key: string, value: string): boolean {
    memory.set(key, value);
    const s = storage();
    if (!s) return false;
    try {
      s.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    memory.delete(key);
    try {
      storage()?.removeItem(key);
    } catch {
      /* best effort */
    }
  },
  /** Whether anything written survives a reload. */
  persistent(): boolean {
    return storage() !== null;
  },
};
