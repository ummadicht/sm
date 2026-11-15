// Pure helpers for sharing a mobile hotspot / Wi‑Fi QR code, the direct
// browser SwapUp Check web link, and the StoreApp offline connectivity check.
// No React Native imports so node --test can test these directly.

export type HotspotSecurity = "WPA" | "WEP" | "nopass";

export type HotspotConfig = {
  ssid: string;
  password: string;
  security: HotspotSecurity;
  hidden: boolean;
};

export const DEFAULT_HOTSPOT: HotspotConfig = {
  ssid: "SwapUp-Hotspot",
  password: "swapup1234",
  security: "WPA",
  hidden: false,
};

export const HOTSPOT_HINT = "Scan with the camera to join this device's hotspot.";
export const HOTSPOT_OFF_TEXT = "Hotspot is switched off.";
export const WEB_CHECK_HINT = "No app download needed — open this link in the browser.";
export const OFFLINE_BANNER_TEXT = "Device is offline — check your Wi‑Fi or mobile connection.";

/** Escape special characters in SSID/password per the ZXing / Android / iOS WIFI: QR spec. */
export function escapeWifiField(raw: string): string {
  return raw.replace(/([\\;,"':])/g, "\\$1");
}

/** Build the standard WIFI: QR payload recognised by Android and iOS cameras. */
export function wifiQr(cfg: {
  ssid: string;
  password?: string;
  security?: HotspotSecurity;
  hidden?: boolean;
}): string {
  const sec: HotspotSecurity = cfg.security ?? "WPA";
  const ssid = escapeWifiField(cfg.ssid.trim());
  const pass = sec === "nopass" ? "" : escapeWifiField(cfg.password ?? "");
  const hidden = cfg.hidden ? "true" : "false";
  return `WIFI:T:${sec};S:${ssid};P:${pass};H:${hidden};;`;
}

/** Build a hotspot configuration for the current device from its model/device name and IP. */
export function currentDeviceHotspot(deviceLabel?: string | null, ip?: string | null): HotspotConfig {
  const rawName = (deviceLabel ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix =
    ip && /^\d+\.\d+\.\d+\.(\d+)$/.test(ip.trim()) && ip.trim() !== "0.0.0.0"
      ? `-${ip.trim().split(".")[3]}`
      : "";
  const baseName = rawName || "SwapUp-Device";
  const ssid = baseName.toLowerCase().endsWith("hotspot")
    ? `${baseName}${suffix}`
    : `${baseName}-Hotspot${suffix}`;
  return {
    ssid,
    password: DEFAULT_HOTSPOT.password,
    security: "WPA",
    hidden: false,
  };
}

/** Direct browser URL for SwapUp Check without downloading the Android APK. */
export function checkWebUrl(base: string, code?: string | null): string {
  const cleanBase = base.trim().replace(/\/+$/, "");
  const cleanCode = (code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleanCode
    ? `${cleanBase}/app/check/?code=${encodeURIComponent(cleanCode)}`
    : `${cleanBase}/app/check/`;
}

/** Pure rule for whether the top connectivity banner should show an offline alert. */
export function isOfflineState(
  net: { isConnected?: boolean | null; isInternetReachable?: boolean | null } | null | undefined,
  browserOnline?: boolean | null
): boolean {
  if (browserOnline === false) return true;
  if (!net) return false;
  if (net.isConnected === false) return true;
  if (net.isInternetReachable === false) return true;
  return false;
}
