// Pure rule for hiding the Android navigation bar during full-screen test colours.
// No runtime imports so `node --test` can test the foreground/background rule directly.

export type NavBarInput = {
  /** Whether a full-screen pattern or colour is currently drawn (`CheckApp` `bleed`). */
  bleed: boolean;
  /** Whether the app is in the foreground (`AppState` `"active"`). */
  appActive: boolean;
  /** Whether this is the browser build (`IS_WEB`). */
  web: boolean;
  /** Optional platform OS name (defaults to `"android"` when omitted). */
  os?: string;
};

/**
 * True when the Android system navigation bar (3-button strip or gesture handle)
 * must be hidden: native Android only, in the foreground, while a full-screen
 * pattern or colour is up.
 */
export function navBarHidden({ bleed, appActive, web, os = "android" }: NavBarInput): boolean {
  if (web || os !== "android") return false;
  return Boolean(bleed && appActive);
}

/** Whether a React Native `AppStateStatus` value means the app is in the foreground. */
export function isAppActive(state: string | null | undefined): boolean {
  return state === "active";
}
