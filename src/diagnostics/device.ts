import * as Device from "expo-device";
import * as Battery from "expo-battery";
import * as FS from "expo-file-system/legacy";
import { DeviceInfo, PowerInfo } from "../shared/types";

export async function readDeviceInfo(): Promise<DeviceInfo> {
  const [total, free, rooted] = await Promise.all([
    FS.getTotalDiskCapacityAsync().catch(() => null),
    FS.getFreeDiskStorageAsync().catch(() => null),
    Device.isRootedExperimentalAsync().catch(() => null),
  ]);
  return {
    brand: Device.brand,
    manufacturer: Device.manufacturer,
    modelName: Device.modelName,
    modelId: Device.modelId,
    deviceName: Device.deviceName,
    osName: Device.osName,
    osVersion: Device.osVersion,
    totalMemoryBytes: Device.totalMemory,
    totalDiskBytes: total,
    freeDiskBytes: free,
    isPhysicalDevice: Device.isDevice,
    rooted,
    cpu: Device.supportedCpuArchitectures,
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
  try {
    const p = await Battery.getPowerStateAsync();
    return {
      levelPct: p.batteryLevel >= 0 ? Math.round(p.batteryLevel * 100) : null,
      state: batteryStateName(p.batteryState),
      lowPowerMode: p.lowPowerMode ?? null,
    };
  } catch {
    return { levelPct: null, state: "unknown", lowPowerMode: null };
  }
}
