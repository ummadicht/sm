// Pure maths behind the automatic native checks (docs/AUTO-TESTS.md): the
// speaker→mic loopback correlation, accelerometer/magnetometer statistics,
// camera-frame luminance, and every pass/fail/skip threshold.
//
// No runtime imports (only `import type`), so it runs as-is under
// `node --test` (type stripping) as well as in the app. Keep it that way:
// a value import here would need a ".ts" suffix for Node, which tsc refuses.
//
// Honesty rule shared by every verdict below: PASS only on positive evidence,
// FAIL only on evidence of a fault, anything else is SKIP with a reason the
// store can read. `detail.method` always says how the verdict was reached.

export type Outcome = "pass" | "fail" | "skip" | "unsupported";
export type Detail = Record<string, string | number | boolean | null>;
export type Verdict = { outcome: Outcome; detail: Detail };

const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export function mean(xs: number[]): number {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population standard deviation. */
export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / xs.length);
}

/** Pearson correlation; null when either side is flat (no variance) or too short to mean anything. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  if (saa < 1e-12 || sbb < 1e-12) return null;
  return sab / Math.sqrt(saa * sbb);
}

/* ───────────────────────── loopback tone ───────────────────────── */

/**
 * The loopback tone (assets/tones/loopback.wav, made by scripts/make-loopback-tone.mjs
 * from these numbers): three bursts of different lengths, so a shifted copy of
 * the pattern never lines up with itself — a lag search can't find a match in
 * noise that isn't there.
 */
export const TONE = { sampleRate: 22050, freqHz: 1200, amplitude: 0.8, fadeMs: 8, lengthMs: 2400 } as const;
/** [startMs, endMs) of each burst, from the start of the file. */
export const TONE_BURSTS: ReadonlyArray<readonly [number, number]> = [
  [0, 400],
  [800, 1600],
  [2000, 2400],
];

/** One metering reading: `t` = ms since play() was called (negative = before), `db` = dBFS (−160…0). */
export type MeterSample = { t: number; db: number };

/** Android's MediaRecorder reports −160 for "no amplitude"; anything below this is treated as the floor. */
export const DB_FLOOR = -90;
export const clampDb = (db: number) => (db < DB_FLOOR ? DB_FLOOR : db > 0 ? 0 : db);

function burstOverlap(from: number, to: number, lagMs: number): number {
  let covered = 0;
  for (const [s, e] of TONE_BURSTS) {
    const a = Math.max(from, s + lagMs);
    const b = Math.min(to, e + lagMs);
    if (b > a) covered += b - a;
  }
  return covered;
}

/**
 * The envelope a working speaker would produce in each reading. Android's
 * metering is "the loudest moment since the previous reading", so each sample
 * covers (previous t, t]; the value is the fraction of that window inside a burst.
 */
export function expectedEnvelope(samples: MeterSample[], lagMs: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const to = samples[i].t;
    const from = i > 0 ? samples[i - 1].t : to - (samples.length > 1 ? samples[1].t - samples[0].t : 50);
    const w = Math.max(1, to - from);
    out.push(Math.min(1, burstOverlap(from, to, lagMs) / w));
  }
  return out;
}

export type Loopback = {
  /** Best correlation over the lag search; null = nothing to correlate (flat signal). */
  corr: number | null;
  lagMs: number | null;
  /** Mean level inside / outside the bursts at the best lag (dBFS, clamped at DB_FLOOR). */
  onDb: number | null;
  offDb: number | null;
  samples: number;
};

/**
 * Correlate the metering with the tone pattern, searching the playback
 * latency (the player starts some tens to hundreds of ms after play()).
 */
export function loopbackCorrelation(samples: MeterSample[], opts: { maxLagMs?: number; stepMs?: number } = {}): Loopback {
  const maxLag = opts.maxLagMs ?? 800;
  const step = opts.stepMs ?? 20;
  const db = samples.map((s) => clampDb(s.db));
  let best: { corr: number; lag: number } | null = null;
  for (let lag = 0; lag <= maxLag; lag += step) {
    const c = pearson(db, expectedEnvelope(samples, lag));
    if (c != null && (!best || c > best.corr)) best = { corr: c, lag };
  }
  if (!best) return { corr: null, lagMs: null, onDb: null, offDb: null, samples: samples.length };
  const env = expectedEnvelope(samples, best.lag);
  const on: number[] = [], off: number[] = [];
  env.forEach((e, i) => {
    if (e >= 0.8) on.push(db[i]);
    else if (e <= 0.05) off.push(db[i]);
  });
  return {
    corr: round(best.corr, 3),
    lagMs: best.lag,
    onDb: on.length ? round(mean(on), 1) : null,
    offDb: off.length ? round(mean(off), 1) : null,
    samples: samples.length,
  };
}

export const SPEAKER_MIN_CORR = 0.6;
export const VOICE_MIN_CORR = 0.5;
/** A heard tone stands clear of the room: at least this much louder inside the bursts than between them. */
export const LOOPBACK_MIN_CONTRAST_DB = 3;
export const MIC_MIN_RANGE_DB = 6;
/** The earpiece is a quiet speaker: if the "earpiece" run is within this of the loudspeaker's level, the OS didn't reroute. */
export const EARPIECE_MAX_LEVEL_VS_SPEAKER_DB = -3;

/** The microphone: does the level move at all? (Room noise alone moves it on a working mic.) */
export function micVerdict(samples: MeterSample[]): Verdict {
  const method = "recorder metering";
  if (samples.length < 5) return { outcome: "skip", detail: { method, reason: "the recorder gave too few readings", samples: samples.length } };
  const raw = samples.map((s) => s.db);
  if (raw.every((d) => d <= -159)) {
    return { outcome: "fail", detail: { method, reason: "the microphone recorded nothing (level stuck at the floor)", samples: samples.length, maxDb: round(Math.max(...raw), 1) } };
  }
  const db = raw.map(clampDb);
  const range = Math.max(...db) - Math.min(...db);
  const d: Detail = { method, samples: samples.length, minDb: round(Math.min(...db), 1), maxDb: round(Math.max(...db), 1), rangeDb: round(range, 1) };
  if (range >= MIC_MIN_RANGE_DB) return { outcome: "pass", detail: d };
  return { outcome: "skip", detail: { ...d, reason: `the level barely moved (${round(range, 1)} dB; need ${MIC_MIN_RANGE_DB})` } };
}

/** The loudspeaker, heard by the microphone. */
export function speakerVerdict(lb: Loopback, micWorks: boolean): Verdict {
  const method = "speaker→mic loopback";
  const d: Detail = { method, corr: lb.corr, lagMs: lb.lagMs, onDb: lb.onDb, offDb: lb.offDb, samples: lb.samples };
  if (!micWorks) return { outcome: "skip", detail: { ...d, reason: "can't listen: the microphone gave no usable signal" } };
  const contrast = lb.onDb != null && lb.offDb != null ? round(lb.onDb - lb.offDb, 1) : null;
  d.contrastDb = contrast;
  if (lb.corr != null && lb.corr >= SPEAKER_MIN_CORR && contrast != null && contrast >= LOOPBACK_MIN_CONTRAST_DB) return { outcome: "pass", detail: d };
  return { outcome: "skip", detail: { ...d, reason: "the test tone was not heard (media volume may be low)" } };
}

/**
 * The earpiece (Android: MODE_IN_COMMUNICATION, speakerphone off). A heard tone
 * only proves the earpiece if it is clearly quieter than the loudspeaker run —
 * otherwise the phone may have played it through the loudspeaker anyway.
 */
export function voiceVerdict(lb: Loopback, micWorks: boolean, speakerOnDb: number | null): Verdict {
  const method = "earpiece→mic loopback";
  const contrast = lb.onDb != null && lb.offDb != null ? round(lb.onDb - lb.offDb, 1) : null;
  const d: Detail = { method, route: "earpiece", corr: lb.corr, lagMs: lb.lagMs, onDb: lb.onDb, offDb: lb.offDb, contrastDb: contrast, speakerOnDb, samples: lb.samples };
  if (!micWorks) return { outcome: "skip", detail: { ...d, reason: "can't listen: the microphone gave no usable signal" } };
  const heard = lb.corr != null && lb.corr >= VOICE_MIN_CORR && contrast != null && contrast >= LOOPBACK_MIN_CONTRAST_DB;
  if (!heard) return { outcome: "skip", detail: { ...d, reason: "the earpiece tone was not heard" } };
  if (speakerOnDb != null && lb.onDb != null && lb.onDb - speakerOnDb > EARPIECE_MAX_LEVEL_VS_SPEAKER_DB) {
    return { outcome: "skip", detail: { ...d, reason: "the tone was as loud as the loudspeaker — the earpiece route was not confirmed" } };
  }
  return { outcome: "pass", detail: d };
}

/* ───────────────────────── vibration ───────────────────────── */

export const VIBRATION_MIN_RATIO = 2.5;
/** Accelerometer noise floor (g) — a perfectly still, coarsely quantised sensor would otherwise divide by ~0. */
export const ACCEL_NOISE_FLOOR_G = 0.002;

/** Accelerometer magnitudes (g) before and during Vibration.vibrate(). */
export function vibrationVerdict(before: number[], during: number[], accelAvailable: boolean): Verdict {
  const method = "accelerometer during vibrate";
  if (!accelAvailable) return { outcome: "skip", detail: { method, reason: "no accelerometer to feel the buzz" } };
  if (before.length < 15 || during.length < 15) {
    return { outcome: "skip", detail: { method, reason: "the accelerometer gave too few readings", before: before.length, during: during.length } };
  }
  const sb = std(before), sd = std(during);
  const ratio = sd / Math.max(sb, ACCEL_NOISE_FLOOR_G);
  const d: Detail = { method, stdBeforeG: round(sb, 4), stdDuringG: round(sd, 4), ratio: round(ratio, 2) };
  if (ratio >= VIBRATION_MIN_RATIO) return { outcome: "pass", detail: d };
  return { outcome: "skip", detail: { ...d, reason: `no clear buzz measured (ratio ${round(ratio, 2)}, need ${VIBRATION_MIN_RATIO}) — phone on a soft surface or moving?` } };
}

/* ───────────────────────── motion ───────────────────────── */

export const GRAVITY_G_MIN = 0.75;
export const GRAVITY_G_MAX = 1.25;
const G = 9.80665;

export type Vec = { x: number; y: number; z: number };
export const magnitude = (v: Vec) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

/** Accelerometer (expo-sensors reports g) + gyroscope, sampled ~1.5 s. */
export function motionVerdict(input: { accelAvailable: boolean; gyroAvailable: boolean; accel: Vec[]; gyroSamples: number }): Verdict {
  const method = "accelerometer + gyroscope sampling";
  const { accelAvailable, gyroAvailable, accel, gyroSamples } = input;
  const base: Detail = { method, accelerometer: accelAvailable, gyroscope: gyroAvailable, accelSamples: accel.length, gyroSamples };
  if (!accelAvailable) return { outcome: "skip", detail: { ...base, reason: "no accelerometer on this phone" } };
  if (accel.length === 0) return { outcome: "fail", detail: { ...base, reason: "the accelerometer is listed but sent no readings" } };
  if (gyroAvailable && gyroSamples === 0) return { outcome: "fail", detail: { ...base, reason: "the gyroscope is listed but sent no readings" } };
  const g = mean(accel.map(magnitude));
  const d: Detail = { ...base, gravityMs2: round(g * G, 2) };
  if (!(g >= GRAVITY_G_MIN && g <= GRAVITY_G_MAX)) {
    return { outcome: "skip", detail: { ...d, reason: `gravity read ${round(g * G, 1)} m/s² (expected about 9.8) — the phone may have been moving` } };
  }
  // A phone built without a gyroscope is not faulty; the store sees `gyroscope: false`.
  return { outcome: "pass", detail: d };
}

/* ───────────────────────── sensors ───────────────────────── */

export function sensorsVerdict(input: {
  magAvailable: boolean;
  mag: Vec[];
  lightAvailable: boolean | null;
  lux: number | null;
  baroAvailable: boolean | null;
  hPa: number | null;
}): Verdict {
  const method = "magnetometer sampling + sensor availability";
  const { magAvailable, mag } = input;
  const base: Detail = {
    method,
    magnetometer: magAvailable,
    magSamples: mag.length,
    lightSensor: input.lightAvailable,
    lux: input.lux == null ? null : Math.round(input.lux),
    barometer: input.baroAvailable,
    pressureHPa: input.hPa == null ? null : Math.round(input.hPa),
  };
  if (!magAvailable) return { outcome: "skip", detail: { ...base, reason: "no magnetometer (compass) on this phone" } };
  if (mag.length === 0) return { outcome: "fail", detail: { ...base, reason: "the magnetometer is listed but silent" } };
  const allZero = mag.every((v) => v.x === 0 && v.y === 0 && v.z === 0);
  if (allZero) return { outcome: "fail", detail: { ...base, reason: "the magnetometer reports only zeros" } };
  const spread = Math.max(std(mag.map((v) => v.x)), std(mag.map((v) => v.y)), std(mag.map((v) => v.z)));
  const d: Detail = { ...base, fieldUT: round(mean(mag.map(magnitude)), 1), spreadUT: round(spread, 3) };
  if (spread > 0) return { outcome: "pass", detail: d };
  return { outcome: "skip", detail: { ...d, reason: "the magnetometer readings never changed" } };
}

/* ───────────────────────── battery / connectivity ───────────────────────── */

export function batteryVerdict(input: { available: boolean; level: number | null; state: string; lowPowerMode: boolean | null }): Verdict {
  const method = "expo-battery";
  if (!input.available) return { outcome: "skip", detail: { method, reason: "the battery API is not available" } };
  const d: Detail = {
    method,
    levelPct: input.level != null && input.level >= 0 ? Math.round(input.level * 100) : null,
    state: input.state,
    lowPowerMode: input.lowPowerMode,
    // Android and iOS never expose battery health to apps — blank, never guessed.
    healthPct: null,
  };
  if (d.levelPct == null) return { outcome: "skip", detail: { ...d, reason: "the battery level could not be read" } };
  return { outcome: "pass", detail: d };
}

export type GpsState = "fix" | "no-fix" | "denied" | "services-off" | "error";

export function connectivityVerdict(input: { connected: boolean | null; gps: GpsState; detail: Detail }): Verdict {
  const method = "network state + cellular + location fix";
  const d: Detail = { method, ...input.detail, connected: input.connected, gps: input.gps };
  if (input.gps === "error") return { outcome: "fail", detail: { ...d, reason: "the GPS reported an error twice" } };
  if (input.connected) return { outcome: "pass", detail: d };
  if (input.gps === "denied") return { outcome: "skip", detail: { ...d, reason: "location refused and offline" } };
  return { outcome: "skip", detail: { ...d, reason: "the phone was offline when checked" } };
}

/* ───────────────────────── camera frames ───────────────────────── */

export type FrameStats = { mean: number; std: number; w: number; h: number };

/** Rec.601 luma mean + standard deviation of an RGBA buffer. */
export function luminanceStats(rgba: Uint8Array, w: number, h: number): FrameStats {
  const n = Math.min(w * h, Math.floor(rgba.length / 4));
  if (n <= 0) return { mean: 0, std: 0, w, h };
  let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const y = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
    s += y;
    s2 += y * y;
  }
  const m = s / n;
  return { mean: round(m, 1), std: round(Math.sqrt(Math.max(0, s2 / n - m * m)), 2), w, h };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_INDEX[B64[i]] = i;
B64_INDEX["-"] = 62;
B64_INDEX["_"] = 63;

/** Base64 (standard or URL-safe; a data: prefix and whitespace are ignored) → bytes. No atob/Buffer needed. */
export function base64ToBytes(b64: string): Uint8Array {
  const s = b64.replace(/^data:[^,]*,/, "").replace(/[\s=]/g, "");
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B64_INDEX[s[i]];
    if (v === undefined) throw new Error("not base64");
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** A frame "sees a scene" when it has this much luminance variation (0–255 scale). */
export const FRAME_MIN_STD = 6;
export const FRAME_DARK_MEAN = 15;

export type FrameKind = "scene" | "dark" | "uniform";
export function frameKind(st: FrameStats): FrameKind {
  if (st.std >= FRAME_MIN_STD) return "scene";
  return st.mean < FRAME_DARK_MEAN ? "dark" : "uniform";
}

export type SideResult =
  | { status: "ok"; stats: FrameStats }
  | { status: "error"; message: string }
  | { status: "timeout" };

const sideName = (s: "back" | "front") => (s === "back" ? "rear" : "front");

/** Both cameras: pass = both frames show a scene; fail = a camera errored; else skip (covered / dark / slow). */
export function cameraVerdict(rear: SideResult, front: SideResult, attempts: number): Verdict {
  const method = "capture → 32 px → luminance";
  const d: Detail = { method, attempts };
  const put = (side: "back" | "front", r: SideResult) => {
    const k = sideName(side);
    if (r.status === "ok") {
      d[`${k}Mean`] = r.stats.mean;
      d[`${k}Std`] = r.stats.std;
      d[`${k}Frame`] = frameKind(r.stats);
    } else d[`${k}Frame`] = r.status === "error" ? "error" : "not ready";
  };
  put("back", rear);
  put("front", front);
  const rearErr = rear.status === "error", frontErr = front.status === "error";
  if (rearErr || frontErr) {
    const side = rearErr && frontErr ? "both" : rearErr ? "rear" : "front";
    const msg = rearErr ? (rear as { message: string }).message : (front as { message: string }).message;
    return { outcome: "fail", detail: { ...d, side, reason: `the ${side === "both" ? "cameras" : side + " camera"} failed to open or capture: ${msg}`.slice(0, 300) } };
  }
  const okScene = (r: SideResult) => r.status === "ok" && frameKind(r.stats) === "scene";
  if (okScene(rear) && okScene(front)) return { outcome: "pass", detail: d };
  const why = (side: "back" | "front", r: SideResult) =>
    r.status === "timeout" ? `the ${sideName(side)} camera did not get ready in time`
    : r.status === "ok" && frameKind(r.stats) === "dark" ? `the ${sideName(side)} camera saw only darkness (lens covered?)`
    : r.status === "ok" && frameKind(r.stats) === "uniform" ? `the ${sideName(side)} camera saw a blank, even frame (lens covered?)`
    : null;
  const reasons = [why("back", rear), why("front", front)].filter(Boolean) as string[];
  const unclear = !okScene(rear) && !okScene(front) ? "both" : !okScene(rear) ? "rear" : "front";
  return { outcome: "skip", detail: { ...d, unclearSide: unclear, reason: reasons.join("; ") || "inconclusive" } };
}

/** Only re-try (once) when a frame was too dark/uniform — not after an error, which is already evidence. */
export function cameraNeedsRetry(rear: SideResult, front: SideResult): boolean {
  if (rear.status === "error" || front.status === "error") return false;
  const bad = (r: SideResult) => r.status !== "ok" || frameKind(r.stats) !== "scene";
  return bad(rear) || bad(front);
}

export const FLASH_MIN_GAIN = 1.15;
export const FLASH_MIN_DELTA = 8;
export const FLASH_BRIGHT_SCENE_MEAN = 170;

/** Rear frame with the torch off vs on. */
export function flashVerdict(off: FrameStats | null, on: FrameStats | null, error: string | null): Verdict {
  const method = "rear frame, torch off vs on";
  if (error) return { outcome: "fail", detail: { method, reason: `the torch could not be switched on: ${error}`.slice(0, 300) } };
  if (!off || !on) return { outcome: "skip", detail: { method, reason: "no frames to compare" } };
  const d: Detail = { method, offMean: off.mean, onMean: on.mean, gain: off.mean > 0 ? round(on.mean / off.mean, 2) : null };
  if (off.mean >= FLASH_BRIGHT_SCENE_MEAN) return { outcome: "skip", detail: { ...d, reason: "the scene was already bright" } };
  if (on.mean >= off.mean * FLASH_MIN_GAIN && on.mean - off.mean >= FLASH_MIN_DELTA) return { outcome: "pass", detail: d };
  return { outcome: "skip", detail: { ...d, reason: "no measurable change with the torch on (lens against a surface, or the camera evened it out)" } };
}
