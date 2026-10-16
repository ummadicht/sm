// Browser shims for the gaps react-native-web leaves. Imported once by
// StoreApp / CheckApp before anything renders; the native twin (./platform.ts)
// is empty, so the Android apps are untouched.
import { Alert, BackHandler } from "react-native";

type AlertButton = { text?: string; onPress?: (value?: string) => void; style?: "default" | "cancel" | "destructive" };

/**
 * react-native-web's Alert.alert is an empty function, so "Sign out?",
 * "Cancel this test?" and "Stop testing?" would silently do nothing. Map them
 * onto the browser's own dialogs:
 *  - 0–1 buttons → window.alert, then that button's onPress
 *  - 2+ buttons  → window.confirm: OK = the last non-cancel button (React
 *    Native puts the main action last), Cancel = the cancel-style button.
 * The browser can't relabel OK/Cancel, so the text says which is which.
 */
function webAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  const list = buttons && buttons.length ? buttons : [{ text: "OK" }];
  const body = [title, message].filter((s) => !!s && String(s).trim()).join("\n\n");
  if (typeof window === "undefined") return;
  if (list.length === 1) {
    window.alert(body);
    list[0].onPress?.();
    return;
  }
  const cancel = list.find((b) => b.style === "cancel") ?? list[0];
  const actions = list.filter((b) => b !== cancel);
  const action = actions[actions.length - 1];
  const hint = action?.text && cancel.text ? `\n\nOK = ${action.text}   ·   Cancel = ${cancel.text}` : "";
  if (window.confirm(body + hint)) action?.onPress?.();
  else cancel.onPress?.();
}

(Alert as unknown as { alert: typeof webAlert }).alert = webAlert;

// There is no hardware back button in a browser, and react-native-web's
// BackHandler.addEventListener logs a console.error on every call. Make it a
// silent no-op (the browser's own Back button is the browser's business).
(BackHandler as unknown as { addEventListener: () => { remove: () => void } }).addEventListener = () => ({ remove() {} });

export {};
