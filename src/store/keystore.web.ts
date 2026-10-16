// Browser twin of ./keystore.ts: there is no OS keystore in a browser, so the
// staff token lives in this origin's localStorage (the same origin as the
// SwapUp web desk, whose session cookie it mirrors). Signing out removes it;
// it expires server-side after 12 hours either way.
import { webStorage } from "../shared/webStorage.web";

export async function read(key: string): Promise<string | null> {
  return webStorage.get(key);
}
export async function write(key: string, value: string): Promise<void> {
  webStorage.set(key, value);
}
export async function remove(key: string): Promise<void> {
  webStorage.remove(key);
}
