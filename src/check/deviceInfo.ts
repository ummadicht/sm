// Map what the phone reports about itself onto the contract's DeviceInfo.
// Deliberately NOT sent: the user-chosen device name (often the owner's name),
// IP address, location, accounts — only what identifies the hardware.
import { Platform } from "react-native";
import { readDeviceInfo, readPower } from "../diagnostics/device";
import { APP_VERSION } from "../shared/config";
import { ContractDevice } from "./core";

export async function contractDevice(): Promise<ContractDevice> {
  const [d, p] = await Promise.all([readDeviceInfo(), readPower()]);
  return {
    brand: d.brand,
    manufacturer: d.manufacturer,
    // Android: Device.modelName is Build.MODEL (e.g. "SM-S901E") — the only model
    // string Android gives apps; it is also the model code the server matches on.
    // iOS: modelName is marketing ("iPhone 13"), modelId the code ("iPhone14,5").
    modelName: d.modelName,
    modelCode: Platform.OS === "android" ? d.modelName : d.modelId ?? d.modelName,
    osVersion: d.osVersion,
    totalDiskBytes: d.totalDiskBytes,
    totalMemoryBytes: d.totalMemoryBytes,
    batteryLevelPct: p.levelPct,
    isPhysicalDevice: d.isPhysicalDevice,
    appVersion: APP_VERSION,
  };
}
