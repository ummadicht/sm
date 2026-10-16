// Where the store app keeps its few strings. Native: the OS keystore
// (expo-secure-store). The browser build uses ./keystore.web.ts instead.
// Every call is best-effort — a keystore hiccup must never crash the counter.
import * as SecureStore from "expo-secure-store";

export async function read(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}
export async function write(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* best effort */
  }
}
export async function remove(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* best effort */
  }
}
