// Browser twin of ./deviceInfo.ts: what a web page may learn about the phone it
// runs on, mapped onto the contract's DeviceInfo — and nothing guessed.
//  - model: User-Agent Client Hints (Chrome / Samsung Internet on Android give
//    the real model code, e.g. "SM-S901E", which the server matches), else the
//    UA string (core.parseUserAgent — reduced-UA placeholders come back null)
//  - OS version: Client Hints platformVersion on Android, else the UA
//  - storage size, RAM, emulator-or-not: a browser can't know → null
//  - battery %: navigator.getBattery() where it exists (Chrome on Android)
//  - appVersion "web-<version>" so the server and the store can tell a browser
//    run from the app
// Like the app, it never sends the device name, accounts, IP or location.
import { CLIENT_VERSION } from "../shared/config";
import { ContractDevice, brandForModel, parseUserAgent, trimVersion } from "./core";

type HighEntropy = { model?: string; platform?: string; platformVersion?: string };
type UAData = { mobile?: boolean; platform?: string; getHighEntropyValues?: (hints: string[]) => Promise<HighEntropy> };
type Nav = Navigator & { userAgentData?: UAData; getBattery?: () => Promise<{ level: number }> };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      }
    );
  });
}

/** Chrome's reduced UA uses "K" for every model; Client Hints answer "" on desktops. */
function realModel(m: string | null | undefined): string | null {
  const t = (m || "").trim();
  return t && t !== "K" ? t : null;
}

export async function contractDevice(): Promise<ContractDevice> {
  const nav = (typeof navigator !== "undefined" ? navigator : {}) as Nav;
  const ua = parseUserAgent(nav.userAgent || "", nav.maxTouchPoints || 0);

  let model = ua.modelCode;
  let osVersion = ua.osVersion;
  let mobile = ua.mobile;
  const uad = nav.userAgentData;
  if (uad && typeof uad.getHighEntropyValues === "function") {
    const h = await withTimeout(uad.getHighEntropyValues(["model", "platformVersion", "platform"]), 1500);
    if (h) {
      model = realModel(h.model) ?? model;
      const platform = (h.platform || uad.platform || "").toLowerCase();
      // Only Android's platformVersion is the OS version (Windows reports something else).
      if (platform === "android") osVersion = trimVersion(h.platformVersion) ?? osVersion;
      else if (platform === "macos") osVersion = h.platformVersion || osVersion;
    }
    if (uad.mobile) mobile = true;
  }

  // A laptop's battery says nothing about a phone; only report it on a phone or tablet.
  let batteryLevelPct: number | null = null;
  if (mobile && typeof nav.getBattery === "function") {
    const b = await withTimeout(nav.getBattery(), 1500);
    if (b && typeof b.level === "number" && isFinite(b.level)) batteryLevelPct = Math.round(b.level * 100);
  }

  const brand = brandForModel(model) ?? ua.brand;
  return {
    brand,
    manufacturer: brand,
    // On Android the model code is the only model string there is (as in the app).
    modelName: model ?? ua.modelName,
    modelCode: model,
    osVersion,
    totalDiskBytes: null,
    totalMemoryBytes: null,
    batteryLevelPct,
    isPhysicalDevice: null,
    appVersion: CLIENT_VERSION,
  };
}
