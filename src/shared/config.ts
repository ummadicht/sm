import Constants from "expo-constants";
import { Platform } from "react-native";
import { appIdOf, identifyApp } from "./api";

export type Variant = "store" | "check";

/** True in the browser builds (Expo web / react-native-web) served at /app/store/ and /app/check/. */
export const IS_WEB = Platform.OS === "web";

const extra = (Constants.expoConfig?.extra ?? {}) as { variant?: Variant; defaultServer?: string };

// EXPO_PUBLIC_* are inlined into the bundle by babel-preset-expo at export time
// (scripts/export-web.sh sets them). Only a static `process.env.EXPO_PUBLIC_X`
// member access is inlined — never destructure or index process.env here.
const ENV_VARIANT = process.env.EXPO_PUBLIC_APP_VARIANT;
const ENV_SERVER = process.env.EXPO_PUBLIC_SWAPUP_SERVER;
const ENV_VERSION = process.env.EXPO_PUBLIC_APP_VERSION;
const ENV_VERSION_CODE = process.env.EXPO_PUBLIC_APP_VERSION_CODE;

/** Web only: the path the bundle is served under, e.g. "/app/store" → which app this page is. */
function webPathMatch(): RegExpMatchArray | null {
  if (!IS_WEB || typeof window === "undefined") return null;
  return window.location.pathname.match(/^(.*?)\/app\/(store|check)(?:\/|$)/);
}

function pickVariant(): Variant {
  // Native: app.config.js `extra` is baked into the APK and is the truth.
  // Web: the app manifest is not reliably carried into the bundle (a store build
  // rendered the check app), so the export inlines the variant; the URL path is
  // the last resort (`expo start --web` without the env var).
  const v = IS_WEB ? ENV_VARIANT ?? webPathMatch()?.[2] ?? extra.variant : extra.variant ?? ENV_VARIANT;
  return v === "store" ? "store" : "check";
}

function pickServer(): string {
  if (IS_WEB && typeof window !== "undefined") {
    // Same-origin hosting: the page at https://host[/base]/app/<variant>/ talks to
    // https://host[/base] — no CORS, and the hand-off cookie lands on the desk's origin.
    if (ENV_SERVER) return ENV_SERVER;
    const m = webPathMatch();
    return window.location.origin + (m ? m[1] : "");
  }
  return extra.defaultServer || "https://swapup.104-197-168-25.sslip.io";
}

export const VARIANT: Variant = pickVariant();
/** Production SwapUp unless the build was made with SWAPUP_SERVER (native), or this page's own origin (web). The store app can override it in Settings on native. */
export const DEFAULT_SERVER = pickServer().replace(/\/$/, "");
const BUILD_VERSION = (IS_WEB ? ENV_VERSION : undefined) ?? Constants.expoConfig?.version ?? ENV_VERSION;
export const APP_VERSION = BUILD_VERSION ?? "0.0.0";
/**
 * The build's Android versionCode (app.config.js android.versionCode — the APK's embedded config
 * keeps it; the browser export inlines it like the version). null = not known.
 */
const BUILD_CODE: unknown = (IS_WEB ? ENV_VERSION_CODE : undefined) ?? Constants.expoConfig?.android?.versionCode ?? ENV_VERSION_CODE ?? null;
// Every call to the server says which app and build this is (./api.ts APP_HEADER): "store/0.9.3+15".
identifyApp(appIdOf(VARIANT, BUILD_VERSION, BUILD_CODE));
/** What the server is told: "0.1.0" from the app, "web-0.1.0" from a browser — so the store can tell a browser run from the app. */
export const CLIENT_VERSION = IS_WEB ? `web-${APP_VERSION}` : APP_VERSION;
