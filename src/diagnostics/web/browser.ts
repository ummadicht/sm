// Browser capability helpers for the *.web.tsx hardware tests (imported only by
// web files). Everything is feature-detected at the moment of use: a missing API
// means "this browser can't run the test", which a test reports as
// "unsupported" — never as a pass.
import type { ViewStyle } from "react-native";

/** The one line a customer sees whenever their browser can't run a test. */
export const CANT_LINE = "Your browser can't test this. The app can — or the advisor will check it.";

export function ua(): string {
  return typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
}

/** iPhone / iPad (iPadOS reports a Mac user agent but has a touch screen). */
export function isIOS(): boolean {
  const u = ua();
  return /iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && (navigator.maxTouchPoints ?? 0) > 1);
}

export function isAndroid(): boolean {
  return /Android/i.test(ua());
}

/** DOMException / Error name, e.g. "NotAllowedError". */
export function errName(e: unknown): string {
  if (e && typeof e === "object" && "name" in e) return String((e as { name: unknown }).name || "Error");
  return "Error";
}

/** A react-native-web host ref is the DOM node itself. */
export function asHtml(x: unknown): HTMLElement | null {
  return typeof HTMLElement !== "undefined" && x instanceof HTMLElement ? x : null;
}

/** CSS that react-native-web passes through but React Native's style types don't know (fixed, touchAction…). */
export function webStyle(o: Record<string, string | number>): ViewStyle {
  return o as unknown as ViewStyle;
}

/* ───────────── motion / orientation permission (iOS 13+) ───────────── */

type PermissionEvent = { requestPermission?: () => Promise<"granted" | "denied" | "default"> };

function motionPermissionApi(): PermissionEvent | null {
  const g = globalThis as unknown as { DeviceMotionEvent?: PermissionEvent; DeviceOrientationEvent?: PermissionEvent };
  if (g.DeviceMotionEvent && typeof g.DeviceMotionEvent.requestPermission === "function") return g.DeviceMotionEvent;
  if (g.DeviceOrientationEvent && typeof g.DeviceOrientationEvent.requestPermission === "function") return g.DeviceOrientationEvent;
  return null;
}

/** True when the browser (iOS Safari) only hands out motion data after the user taps. */
export function motionNeedsTap(): boolean {
  return motionPermissionApi() != null;
}

/**
 * Ask for motion + orientation access. MUST be called synchronously from a tap
 * handler on iOS. WebKit keeps one permission for both event types.
 */
export async function requestMotionAccess(): Promise<"granted" | "denied" | "not-needed"> {
  const api = motionPermissionApi();
  if (!api?.requestPermission) return "not-needed";
  try {
    return (await api.requestPermission()) === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/** What to say when motion access was refused (the way back differs per browser). */
export function MOTION_DENIED(): string {
  return isIOS()
    ? "Motion access was turned down. To allow it, close Safari completely and open this page again — or skip this test."
    : "Motion sensors are blocked for this page. Allow them (tap the lock or ⓘ next to the address → Motion sensors), then tap Ask again — or skip this test.";
}

/* ───────────── camera / microphone ───────────── */

export function hasGetUserMedia(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function";
}

export type MediaFailure = "denied" | "missing" | "busy" | "other";

/** Map a getUserMedia rejection to what we tell the customer. */
export function mediaFailure(e: unknown): MediaFailure {
  const n = errName(e);
  if (n === "NotAllowedError" || n === "SecurityError" || n === "PermissionDeniedError") return "denied";
  if (n === "NotFoundError" || n === "OverconstrainedError" || n === "DevicesNotFoundError") return "missing";
  if (n === "NotReadableError" || n === "TrackStartError" || n === "AbortError") return "busy";
  return "other";
}

export function stopStream(s: MediaStream | null | undefined): void {
  s?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* already stopped */
    }
  });
}

/* ───────────── sound ───────────── */

/**
 * A WAV of `count` 1 kHz beeps, as a blob URL. Played through an <audio>
 * element (not Web Audio) because iPhones mute Web Audio when the ring/silent
 * switch is on, but still play media elements.
 */
export function beepsWavUrl(count: number): string {
  const rate = 22050;
  const beep = 0.2;
  const gap = 0.16;
  const lead = 0.08;
  const tail = 0.1;
  const total = lead + count * beep + (count - 1) * gap + tail;
  const n = Math.ceil(total * rate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate - lead;
    let s = 0;
    if (t >= 0) {
      const k = Math.floor(t / (beep + gap));
      const local = t - k * (beep + gap);
      if (k < count && local < beep) {
        const env = Math.min(1, local / 0.012, (beep - local) / 0.012); // no clicks
        s = Math.sin(2 * Math.PI * 1000 * t) * 0.85 * env;
      }
    }
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/* ───────────── experimental APIs we feature-detect (not in lib.dom) ───────────── */

export type BatteryManagerLike = EventTarget & {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
};

/**
 * navigator.getBattery, bounded: some embedded browsers expose it but never
 * answer, so no answer within `ms` rejects ("can't test" — not a hang).
 */
export function batteryApi(ms = 3000): (() => Promise<BatteryManagerLike>) | null {
  const n = typeof navigator !== "undefined" ? (navigator as unknown as { getBattery?: () => Promise<BatteryManagerLike> }) : null;
  if (!n || typeof n.getBattery !== "function") return null;
  const get = n.getBattery.bind(navigator);
  return () => withTimeout(get(), ms);
}

/** Reject with a TimeoutError if `p` hasn't settled within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export type NetworkInformationLike = EventTarget & {
  type?: string;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

export function connectionApi(): NetworkInformationLike | null {
  const n = typeof navigator !== "undefined" ? (navigator as unknown as { connection?: NetworkInformationLike }) : null;
  return n?.connection ?? null;
}

export type BluetoothLike = { getAvailability?: () => Promise<boolean> };

export function bluetoothApi(): BluetoothLike | null {
  const n = typeof navigator !== "undefined" ? (navigator as unknown as { bluetooth?: BluetoothLike }) : null;
  return n?.bluetooth && typeof n.bluetooth.getAvailability === "function" ? n.bluetooth : null;
}

export type NdefReaderLike = EventTarget & {
  scan: (opts?: { signal?: AbortSignal }) => Promise<void>;
  onreading: ((e: Event) => void) | null;
  onreadingerror: ((e: Event) => void) | null;
};

export function ndefReaderCtor(): (new () => NdefReaderLike) | null {
  const g = globalThis as unknown as { NDEFReader?: new () => NdefReaderLike };
  return typeof g.NDEFReader === "function" ? g.NDEFReader : null;
}

/** Orientation event fields Safari adds (compass heading, clockwise from north). */
export type OrientationEventLike = DeviceOrientationEvent & { webkitCompassHeading?: number };
