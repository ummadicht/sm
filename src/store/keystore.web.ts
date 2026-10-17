// Browser twin of ./keystore.ts: there is no OS keystore in a browser, so the
// staff token lives in this origin's localStorage (the same origin as the
// SwapUp web desk, whose session cookie it mirrors). Signing out removes it;
// it expires server-side after 12 hours either way. A store tablet's device
// token (an iPad running the browser build) lives here too, until a manager
// removes the tablet.
import { webStorage } from "../shared/webStorage.web";

export async function read(key: string): Promise<string | null> {
  return webStorage.get(key);
}
export async function write(key: string, value: string): Promise<void> {
  webStorage.set(key, value);
}
/** False when this browser keeps nothing past a reload (private browsing, storage blocked). */
export function persistent(): boolean {
  return webStorage.persistent();
}
export async function remove(key: string): Promise<void> {
  webStorage.remove(key);
}
