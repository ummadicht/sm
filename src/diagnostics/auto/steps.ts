// The automatic native checks that need no screen of their own (docs/AUTO-TESTS.md).
// Each reads the hardware for a second or two and hands the readings to the
// pure verdicts in ./analysis — nothing here decides pass/fail by itself.
// Native only: the browser build never imports this (src/check/NativeCheck.web.tsx).
import { Platform, Vibration } from "react-native";
import * as Battery from "expo-battery";
import * as Cellular from "expo-cellular";
import * as Device from "expo-device";
import * as LA from "expo-local-authentication";
import * as Location from "expo-location";
import * as Network from "expo-network";
import { Accelerometer, Barometer, Gyroscope, LightSensor, Magnetometer } from "expo-sensors";
import { batteryStateName } from "../device";
import {
  type Detail,
  type GpsState,
  type Vec,
  type Verdict,
  batteryVerdict,
  connectivityVerdict,
  magnitude,
  motionVerdict,
  sensorsVerdict,
  vibrationVerdict,
} from "./analysis";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolve with `fallback` if `p` takes longer than `ms` (a sensor/API that never answers must not stall the run). */
export function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      }
    );
  });
}

type Sub = { remove: () => void };
type Sensor<T> = { setUpdateInterval: (ms: number) => void; addListener: (fn: (d: T) => void) => Sub };

/** Collect readings from one sensor for `ms`. */
async function sample<T>(sensor: Sensor<T>, intervalMs: number, ms: number): Promise<T[]> {
  const out: T[] = [];
  let sub: Sub | null = null;
  try {
    sensor.setUpdateInterval(intervalMs);
    sub = sensor.addListener((d) => out.push(d));
    await sleep(ms);
  } finally {
    sub?.remove();
  }
  return out;
}

const avail = (p: Promise<boolean>) => within(p, 2000, false);

// ─────────────────────────────── battery

export async function batteryStep(): Promise<Verdict> {
  const available = await avail(Battery.isAvailableAsync());
  if (!available) return batteryVerdict({ available: false, level: null, state: "unknown", lowPowerMode: null });
  const ps = await within(Battery.getPowerStateAsync().then((p) => p as Battery.PowerState | null), 3000, null);
  if (!ps) return batteryVerdict({ available: true, level: null, state: "unknown", lowPowerMode: null });
  return batteryVerdict({ available: true, level: ps.batteryLevel, state: batteryStateName(ps.batteryState), lowPowerMode: ps.lowPowerMode ?? null });
}

/** Charging or full right now? (null = can't tell) */
export async function isCharging(): Promise<boolean | null> {
  if (!(await avail(Battery.isAvailableAsync()))) return null;
  const s = await within(Battery.getBatteryStateAsync().then((x) => x as Battery.BatteryState | null), 3000, null);
  if (s == null) return null;
  const n = batteryStateName(s);
  return n === "charging" || n === "full";
}

// ─────────────────────────────── sensors (compass / light / barometer)

export async function sensorsStep(): Promise<Verdict> {
  const [magAvailable, lightAvailable, baroAvailable] = await Promise.all([
    avail(Magnetometer.isAvailableAsync()),
    Platform.OS === "android" ? avail(LightSensor.isAvailableAsync()) : Promise.resolve(null),
    avail(Barometer.isAvailableAsync()),
  ]);
  const [mag, light, baro] = await Promise.all([
    magAvailable ? sample(Magnetometer, 50, 1500) : Promise.resolve([]),
    lightAvailable ? sample(LightSensor, 200, 1200) : Promise.resolve([]),
    baroAvailable ? sample(Barometer, 200, 1200) : Promise.resolve([]),
  ]);
  return sensorsVerdict({
    magAvailable,
    mag: mag.map((m) => ({ x: m.x, y: m.y, z: m.z })),
    lightAvailable,
    lux: light.length ? light[light.length - 1].illuminance : null,
    baroAvailable,
    hPa: baro.length ? baro[baro.length - 1].pressure : null,
  });
}

// ─────────────────────────────── motion (accelerometer + gyroscope)

export async function motionStep(): Promise<Verdict> {
  const [accelAvailable, gyroAvailable] = await Promise.all([avail(Accelerometer.isAvailableAsync()), avail(Gyroscope.isAvailableAsync())]);
  const [accel, gyro] = await Promise.all([
    accelAvailable ? sample(Accelerometer, 20, 1500) : Promise.resolve([]),
    gyroAvailable ? sample(Gyroscope, 20, 1500) : Promise.resolve([]),
  ]);
  return motionVerdict({ accelAvailable, gyroAvailable, accel: accel.map((a) => ({ x: a.x, y: a.y, z: a.z })), gyroSamples: gyro.length });
}

// ─────────────────────────────── vibration (felt by the accelerometer)

export async function vibrationStep(): Promise<Verdict> {
  const accelAvailable = await avail(Accelerometer.isAvailableAsync());
  if (!accelAvailable) return vibrationVerdict([], [], false);
  const readings: { t: number; m: number }[] = [];
  let sub: Sub | null = null;
  let t0 = 0;
  try {
    Accelerometer.setUpdateInterval(10); // ~100 Hz
    sub = Accelerometer.addListener((a: Vec) => readings.push({ t: Date.now(), m: magnitude(a) }));
    await sleep(800); // quiet baseline
    t0 = Date.now();
    Vibration.vibrate(700);
    await sleep(850);
  } finally {
    sub?.remove();
    Vibration.cancel();
  }
  const before = readings.filter((r) => r.t >= t0 - 650 && r.t < t0 - 50).map((r) => r.m);
  const during = readings.filter((r) => r.t >= t0 + 120 && r.t < t0 + 650).map((r) => r.m);
  return vibrationVerdict(before, during, true);
}

// ─────────────────────────────── connectivity (network, SIM, GPS)

const genName = (g: Cellular.CellularGeneration | null) =>
  g === Cellular.CellularGeneration.CELLULAR_5G ? "5G"
  : g === Cellular.CellularGeneration.CELLULAR_4G ? "4G"
  : g === Cellular.CellularGeneration.CELLULAR_3G ? "3G"
  : g === Cellular.CellularGeneration.CELLULAR_2G ? "2G"
  : null;

/** A failed position request that just means "no fix right now" (indoors, timeout, services off) — not a GPS fault. */
const NO_FIX_ERROR = /unavailable|timed?\s?out|timeout|disabled|services|settings|permission|denied|not authorized/i;

export async function connectivityStep(): Promise<Verdict> {
  const [net, carrier, gen, iso] = await Promise.all([
    within(Network.getNetworkStateAsync().then((x) => x as Network.NetworkState | null), 4000, null),
    within(Cellular.getCarrierNameAsync(), 3000, null),
    within(Cellular.getCellularGenerationAsync().then((x) => x as Cellular.CellularGeneration | null), 3000, null),
    within(Cellular.getIsoCountryCodeAsync(), 3000, null),
  ]);
  const detail: Detail = {
    networkType: net?.type ? String(net.type) : null,
    internet: net?.isInternetReachable ?? null,
    carrier: carrier || null,
    cellular: genName(gen),
    simCountry: iso || null,
    simPresent: !!carrier,
  };

  let gps: GpsState = "no-fix";
  const perm = await within(Location.getForegroundPermissionsAsync().then((p) => p as Location.LocationPermissionResponse | null), 3000, null);
  if (!perm?.granted) gps = "denied";
  else if (!(await within(Location.hasServicesEnabledAsync(), 3000, true))) gps = "services-off";
  else {
    const deadline = Date.now() + 10_000;
    let errors = 0;
    while (Date.now() < deadline) {
      try {
        const left = deadline - Date.now();
        const fix = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.LocationAccuracy.High }),
          sleep(left).then(() => null),
        ]);
        if (fix) {
          gps = "fix";
          detail.gpsAccuracyM = Math.round(fix.coords.accuracy ?? 0);
        }
        break;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (NO_FIX_ERROR.test(msg)) {
          detail.gpsNote = msg.slice(0, 160);
          break;
        }
        errors++;
        detail.gpsError = msg.slice(0, 160);
        if (errors >= 2) {
          gps = "error";
          break;
        }
        await sleep(500);
      }
    }
  }
  return connectivityVerdict({ connected: net?.isConnected ?? null, gps, detail });
}

// ─────────────────────────────── biometrics (never exercised automatically)

export async function faceidStep(): Promise<Verdict> {
  const method = "expo-local-authentication probe";
  const [hardware, enrolled, types] = await Promise.all([
    within(LA.hasHardwareAsync().then((x) => x as boolean | null), 3000, null),
    within(LA.isEnrolledAsync().then((x) => x as boolean | null), 3000, null),
    within(LA.supportedAuthenticationTypesAsync().then((x) => x as LA.AuthenticationType[] | null), 3000, null),
  ]);
  const names = (types ?? []).map((t) =>
    t === LA.AuthenticationType.FACIAL_RECOGNITION ? "face" : t === LA.AuthenticationType.FINGERPRINT ? "fingerprint" : t === LA.AuthenticationType.IRIS ? "iris" : "other"
  );
  return {
    outcome: "skip",
    detail: {
      method,
      hardware,
      enrolled,
      types: names.join(", ") || null,
      reason: hardware === false ? "no fingerprint or face hardware reported" : "checking the sensor needs the owner's finger or face — the advisor checks it",
    },
  };
}

// ─────────────────────────────── bluetooth / nfc / flash hardware (Android feature list)

export async function hasFeature(feature: string): Promise<boolean | null> {
  if (Platform.OS !== "android") return null;
  return within(Device.hasPlatformFeatureAsync(feature).then((x) => x as boolean | null), 3000, null);
}

export async function featureStep(id: "bluetooth" | "nfc"): Promise<Verdict> {
  const feature = id === "bluetooth" ? "android.hardware.bluetooth" : "android.hardware.nfc";
  const method = "Android feature list";
  const has = await hasFeature(feature);
  if (has === true) return { outcome: "pass", detail: { method, feature, present: true } };
  if (has === false) return { outcome: "unsupported", detail: { method, feature, present: false, reason: `this phone has no ${id === "nfc" ? "NFC" : "Bluetooth"}` } };
  return { outcome: "skip", detail: { method, feature, present: null, reason: Platform.OS === "android" ? "the feature list did not answer" : "the feature list is Android-only" } };
}
