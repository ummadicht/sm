// Browser version of the device reader. A web page sees much less than an app:
//  - model code: Chrome on Android hides the model in its user agent ("K"),
//    but gives it through User-Agent Client Hints (getHighEntropyValues
//    "model", e.g. "SM-S901E") — the same code the server matches on.
//    iPhone Safari only says "iPhone"; the advisor confirms the model.
//  - storage / RAM size: not available to a page (navigator.deviceMemory is a
//    capped bucket, storage.estimate is a quota) → null, never guessed.
import * as Battery from "expo-battery";
import { DeviceInfo, PowerInfo } from "../shared/types";
import { batteryApi, isAndroid, isIOS, ua } from "./web/browser";

type UAData = {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platform?: string; platformVersion?: string }>;
};

function brandFromModel(model: string | null): string | null {
  if (!model) return null;
  if (/^SM-|^Galaxy/i.test(model)) return "samsung";
  if (/^Pixel/i.test(model)) return "google";
  if (/^iPhone|^iPad/i.test(model)) return "Apple";
  return null;
}

function androidVersionFromUA(u: string): string | null {
  const m = /Android (\d+(?:\.\d+)*)/i.exec(u);
  return m ? m[1] : null;
}

function iosVersionFromUA(u: string): string | null {
  const m = /OS (\d+(?:_\d+)*) like Mac OS X/i.exec(u);
  return m ? m[1].replace(/_/g, ".") : null;
}

/** The model the old (pre-reduction) Android user agent carried, e.g. "SM-A525F" — "K" means hidden. */
function androidModelFromUA(u: string): string | null {
  const m = /Android [^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?\)/i.exec(u);
  const model = m ? m[1].trim() : null;
  return model && model !== "K" && !/^wv$/i.test(model) ? model : null;
}

export async function readDeviceInfo(): Promise<DeviceInfo> {
  const u = ua();
  const ios = isIOS();
  const android = isAndroid();
  let model: string | null = null;
  let osVersion: string | null = ios ? iosVersionFromUA(u) : android ? androidVersionFromUA(u) : null;
  const uaData = (navigator as unknown as { userAgentData?: UAData }).userAgentData;
  if (uaData && typeof uaData.getHighEntropyValues === "function") {
    try {
      const h = await uaData.getHighEntropyValues(["model", "platformVersion"]);
      if (h.model) model = h.model;
      if (android && h.platformVersion) osVersion = h.platformVersion.replace(/(\.0)+$/, "") || osVersion;
    } catch {
      /* hints refused — fall back to the user agent */
    }
  }
  if (!model && android) model = androidModelFromUA(u);
  if (!model && ios) model = /iPad/.test(u) || (/Macintosh/.test(u) && ios) ? "iPad" : "iPhone";
  const brand = brandFromModel(model) ?? (ios ? "Apple" : null);
  return {
    brand,
    manufacturer: brand,
    modelName: model,
    // check/deviceInfo.ts sends modelId (when not Android) as the model code.
    // Only a real code counts — "iPhone" alone identifies nothing.
    modelId: model && model !== "iPhone" && model !== "iPad" ? model : null,
    deviceName: null, // never sent: often the owner's name
    osName: ios ? "iOS" : android ? "Android" : uaData?.platform ?? null,
    osVersion,
    totalMemoryBytes: null,
    totalDiskBytes: null,
    freeDiskBytes: null,
    isPhysicalDevice: !(navigator as unknown as { webdriver?: boolean }).webdriver,
    rooted: null,
    cpu: null,
  };
}

export function batteryStateName(s: Battery.BatteryState): PowerInfo["state"] {
  switch (s) {
    case Battery.BatteryState.CHARGING: return "charging";
    case Battery.BatteryState.FULL: return "full";
    case Battery.BatteryState.UNPLUGGED: return "unplugged";
    case Battery.BatteryState.NOT_CHARGING: return "not_charging";
    default: return "unknown";
  }
}

export async function readPower(): Promise<PowerInfo> {
  const get = batteryApi();
  if (!get) return { levelPct: null, state: "unknown", lowPowerMode: null };
  try {
    const b = await get();
    const levelPct = Number.isFinite(b.level) ? Math.round(b.level * 100) : null;
    return { levelPct, state: b.charging ? (levelPct === 100 ? "full" : "charging") : "unplugged", lowPowerMode: null };
  } catch {
    return { levelPct: null, state: "unknown", lowPowerMode: null };
  }
}
