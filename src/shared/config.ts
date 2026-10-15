import Constants from "expo-constants";

export type Variant = "store" | "check";

const extra = (Constants.expoConfig?.extra ?? {}) as { variant?: Variant; defaultServer?: string };

export const VARIANT: Variant = extra.variant === "store" ? "store" : "check";
/** Production SwapUp unless the build was made with SWAPUP_SERVER. The store app can override it in Settings. */
export const DEFAULT_SERVER = (extra.defaultServer || "https://swapup.104-197-168-25.sslip.io").replace(/\/$/, "");
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";
