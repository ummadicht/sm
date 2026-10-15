import { Results } from "../diagnostics/catalog";

export type DeviceInfo = {
  brand: string | null;
  manufacturer: string | null;
  modelName: string | null;
  modelId: string | null;
  deviceName: string | null;
  osName: string | null;
  osVersion: string | null;
  totalMemoryBytes: number | null;
  totalDiskBytes: number | null;
  freeDiskBytes: number | null;
  isPhysicalDevice: boolean;
  rooted: boolean | null;
  cpu: string[] | null;
};

export type PowerInfo = {
  levelPct: number | null;
  state: "unknown" | "unplugged" | "charging" | "full" | "not_charging";
  lowPowerMode: boolean | null;
};

/** Free-text + structured detail each test may attach (sensor readings, carrier…). */
export type Detail = Record<string, string | number | boolean | null>;

export type Session = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  imei: string;
  serial: string;
  notes: string;
  device: DeviceInfo | null;
  power: PowerInfo | null;
  results: Results;
  details: Record<string, Detail>;
  /** Wall-clock seconds spent per test. */
  durations: Record<string, number>;
};

export type Settings = {
  /** GradeIQ / SuperIQ ingest URL, e.g. https://thesuperiq.com/apps/platform/api/diagnostics/ingest */
  ingestUrl: string;
  /** Shared webhook secret (sent as x-webhook-secret). */
  ingestSecret: string;
  operator: string;
};

export const DEFAULT_SETTINGS: Settings = { ingestUrl: "", ingestSecret: "", operator: "" };
