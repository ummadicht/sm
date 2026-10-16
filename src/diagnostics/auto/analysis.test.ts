// node --test src/diagnostics/auto/*.test.ts   (Node ≥ 22.18 strips the types itself)
// The module is loaded with an explicit ".ts" at runtime (Node needs it) while
// tsc type-checks against the extensionless path (tsc refuses ".ts" imports).
import test from "node:test";
import assert from "node:assert/strict";

const A: typeof import("./analysis") = await import("./analysis" + ".ts");

/** Deterministic noise. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Metering every `step` ms from −600 to 3300 ms; inside a (latency-shifted) burst the level is `onDb`. */
function meter(opts: { latency: number; onDb: number; offDb: number; noise: number; seed?: number; step?: number; heard?: boolean }) {
  const r = rng(opts.seed ?? 1);
  const step = opts.step ?? 50;
  const out: { t: number; db: number }[] = [];
  for (let t = -600; t <= 3300; t += step) {
    const inBurst = opts.heard !== false && A.TONE_BURSTS.some(([s, e]) => t - opts.latency > s && t - opts.latency <= e);
    out.push({ t, db: (inBurst ? opts.onDb : opts.offDb) + (r() - 0.5) * 2 * opts.noise });
  }
  return out;
}

test("pearson: perfect, inverse, flat", () => {
  assert.equal(A.pearson([1, 2, 3, 4], [2, 4, 6, 8])!.toFixed(6), "1.000000");
  assert.equal(A.pearson([1, 2, 3, 4], [8, 6, 4, 2])!.toFixed(6), "-1.000000");
  assert.equal(A.pearson([1, 1, 1, 1], [1, 2, 3, 4]), null);
  assert.equal(A.pearson([1, 2], [1, 2]), null);
});

test("mean/std", () => {
  assert.equal(A.mean([1, 2, 3]), 2);
  assert.equal(A.std([2, 4, 4, 4, 5, 5, 7, 9]), 2);
  assert.equal(A.std([5]), 0);
});

test("expected envelope covers each reading's window", () => {
  const s = [{ t: 0, db: 0 }, { t: 100, db: 0 }, { t: 200, db: 0 }, { t: 500, db: 0 }, { t: 900, db: 0 }];
  const e = A.expectedEnvelope(s, 0).map((x) => Math.round(x * 1000) / 1000);
  // (−100,0] (0,100] (100,200] (200,500]: 200 of 300 ms in burst 1 · (500,900]: 100 of 400 ms in burst 2
  assert.deepEqual(e, [0, 1, 1, 0.667, 0.25]);
  // Shifted by a 100 ms latency the first two windows move out of / into the burst.
  assert.deepEqual(A.expectedEnvelope(s, 100).slice(0, 3), [0, 0, 1]);
});

test("loopback: a heard tone correlates and the lag search finds the latency", () => {
  const lb = A.loopbackCorrelation(meter({ latency: 180, onDb: -12, offDb: -48, noise: 4 }));
  assert.ok(lb.corr! >= 0.9, `corr ${lb.corr}`);
  assert.ok(Math.abs(lb.lagMs! - 180) <= 60, `lag ${lb.lagMs}`);
  assert.ok(lb.onDb! - lb.offDb! > 25);
});

test("loopback: room noise alone does not reach the speaker threshold", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const lb = A.loopbackCorrelation(meter({ latency: 0, onDb: -40, offDb: -40, noise: 8, seed, heard: false }));
    assert.ok(lb.corr == null || lb.corr < A.SPEAKER_MIN_CORR, `seed ${seed}: corr ${lb.corr}`);
    assert.notEqual(A.speakerVerdict(lb, true).outcome, "pass");
  }
});

test("loopback: digital silence (−160 everywhere) has nothing to correlate", () => {
  const s = Array.from({ length: 60 }, (_, i) => ({ t: -600 + i * 60, db: -160 }));
  const lb = A.loopbackCorrelation(s);
  assert.equal(lb.corr, null);
});

test("speaker verdict: pass on a clear tone; skip when not heard or the mic is dead", () => {
  const heard = A.loopbackCorrelation(meter({ latency: 250, onDb: -10, offDb: -50, noise: 3 }));
  const v = A.speakerVerdict(heard, true);
  assert.equal(v.outcome, "pass");
  assert.equal(v.detail.method, "speaker→mic loopback");
  assert.equal(A.speakerVerdict(heard, false).outcome, "skip");
  const faint = A.loopbackCorrelation(meter({ latency: 250, onDb: -49, offDb: -50, noise: 3 }));
  const fv = A.speakerVerdict(faint, true);
  assert.equal(fv.outcome, "skip");
  assert.match(String(fv.detail.reason), /not heard/);
});

test("mic verdict: moving level passes, floor fails, flat skips", () => {
  assert.equal(A.micVerdict(meter({ latency: 0, onDb: -15, offDb: -50, noise: 2 })).outcome, "pass");
  const floor = Array.from({ length: 40 }, (_, i) => ({ t: i * 50, db: -160 }));
  const f = A.micVerdict(floor);
  assert.equal(f.outcome, "fail");
  assert.match(String(f.detail.reason), /floor/);
  const flat = Array.from({ length: 40 }, (_, i) => ({ t: i * 50, db: -42 + (i % 2) }));
  assert.equal(A.micVerdict(flat).outcome, "skip");
  assert.equal(A.micVerdict(floor.slice(0, 3)).outcome, "skip");
});

test("voice verdict: earpiece must be clearly quieter than the loudspeaker", () => {
  const ear = A.loopbackCorrelation(meter({ latency: 200, onDb: -30, offDb: -55, noise: 2 }));
  assert.equal(A.voiceVerdict(ear, true, -10).outcome, "pass");
  assert.equal(A.voiceVerdict(ear, true, null).outcome, "pass");
  const loud = A.loopbackCorrelation(meter({ latency: 200, onDb: -11, offDb: -55, noise: 2 }));
  const v = A.voiceVerdict(loud, true, -10);
  assert.equal(v.outcome, "skip");
  assert.match(String(v.detail.reason), /not confirmed/);
  const silent = A.loopbackCorrelation(meter({ latency: 0, onDb: -55, offDb: -55, noise: 3, heard: false }));
  assert.equal(A.voiceVerdict(silent, true, -10).outcome, "skip");
});

test("vibration: ratio threshold, too few samples, no accelerometer", () => {
  const r = rng(7);
  const still = Array.from({ length: 40 }, () => 1 + (r() - 0.5) * 0.006);
  const buzz = Array.from({ length: 50 }, () => 1 + (r() - 0.5) * 0.12);
  const v = A.vibrationVerdict(still, buzz, true);
  assert.equal(v.outcome, "pass");
  assert.ok(Number(v.detail.ratio) >= A.VIBRATION_MIN_RATIO);
  assert.equal(A.vibrationVerdict(still, still, true).outcome, "skip");
  assert.equal(A.vibrationVerdict(still.slice(0, 5), buzz, true).outcome, "skip");
  assert.equal(A.vibrationVerdict(still, buzz, false).outcome, "skip");
  // A coarse sensor that reads exactly the same value while still: the noise floor stops a divide-by-zero pass.
  const flat = Array.from({ length: 40 }, () => 1);
  const tiny = Array.from({ length: 40 }, (_, i) => 1 + (i % 2) * 0.002);
  assert.equal(A.vibrationVerdict(flat, tiny, true).outcome, "skip");
});

test("motion: gravity window, silent sensors fail, no gyro is not a fault", () => {
  const lying = Array.from({ length: 60 }, () => ({ x: 0.01, y: -0.02, z: -0.99 }));
  assert.equal(A.motionVerdict({ accelAvailable: true, gyroAvailable: true, accel: lying, gyroSamples: 60 }).outcome, "pass");
  assert.equal(A.motionVerdict({ accelAvailable: true, gyroAvailable: false, accel: lying, gyroSamples: 0 }).outcome, "pass");
  assert.equal(A.motionVerdict({ accelAvailable: true, gyroAvailable: true, accel: [], gyroSamples: 60 }).outcome, "fail");
  assert.equal(A.motionVerdict({ accelAvailable: true, gyroAvailable: true, accel: lying, gyroSamples: 0 }).outcome, "fail");
  assert.equal(A.motionVerdict({ accelAvailable: false, gyroAvailable: false, accel: [], gyroSamples: 0 }).outcome, "skip");
  const shaken = Array.from({ length: 60 }, () => ({ x: 1.2, y: 0.4, z: -0.9 }));
  assert.equal(A.motionVerdict({ accelAvailable: true, gyroAvailable: true, accel: shaken, gyroSamples: 60 }).outcome, "skip");
  const v = A.motionVerdict({ accelAvailable: true, gyroAvailable: true, accel: lying, gyroSamples: 60 });
  assert.ok(Math.abs(Number(v.detail.gravityMs2) - 9.72) < 0.1);
});

test("sensors: varying magnetometer passes; silent / zeros fail; absent or frozen skips", () => {
  const base = { lightAvailable: true, lux: 312.4, baroAvailable: false, hPa: null };
  const varying = Array.from({ length: 30 }, (_, i) => ({ x: 20 + (i % 3) * 0.3, y: -5, z: 40 }));
  const v = A.sensorsVerdict({ ...base, magAvailable: true, mag: varying });
  assert.equal(v.outcome, "pass");
  assert.equal(v.detail.lux, 312);
  assert.equal(A.sensorsVerdict({ ...base, magAvailable: true, mag: [] }).outcome, "fail");
  assert.equal(A.sensorsVerdict({ ...base, magAvailable: true, mag: Array(10).fill({ x: 0, y: 0, z: 0 }) }).outcome, "fail");
  assert.equal(A.sensorsVerdict({ ...base, magAvailable: false, mag: [] }).outcome, "skip");
  assert.equal(A.sensorsVerdict({ ...base, magAvailable: true, mag: Array(10).fill({ x: 1, y: 2, z: 3 }) }).outcome, "skip");
});

test("battery + connectivity verdicts", () => {
  assert.equal(A.batteryVerdict({ available: true, level: 0.83, state: "unplugged", lowPowerMode: false }).detail.levelPct, 83);
  assert.equal(A.batteryVerdict({ available: true, level: -1, state: "unknown", lowPowerMode: null }).outcome, "skip");
  assert.equal(A.batteryVerdict({ available: false, level: null, state: "unknown", lowPowerMode: null }).outcome, "skip");
  assert.equal(A.connectivityVerdict({ connected: true, gps: "no-fix", detail: {} }).outcome, "pass");
  assert.equal(A.connectivityVerdict({ connected: true, gps: "denied", detail: {} }).outcome, "pass");
  assert.equal(A.connectivityVerdict({ connected: true, gps: "error", detail: {} }).outcome, "fail");
  assert.equal(A.connectivityVerdict({ connected: false, gps: "denied", detail: {} }).detail.reason, "location refused and offline");
  assert.equal(A.connectivityVerdict({ connected: false, gps: "fix", detail: {} }).outcome, "skip");
});

test("luminance stats over RGBA", () => {
  const w = 4, h = 2;
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(i % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], i * 4);
  const s = A.luminanceStats(px, w, h);
  assert.ok(Math.abs(s.mean - 127.5) < 0.2);
  assert.ok(Math.abs(s.std - 127.5) < 0.2);
  const grey = new Uint8Array(16 * 4).fill(90);
  const g = A.luminanceStats(grey, 4, 4);
  assert.equal(g.std, 0);
  assert.equal(A.frameKind(g), "uniform");
  assert.equal(A.frameKind({ mean: 3, std: 1, w: 1, h: 1 }), "dark");
  assert.equal(A.frameKind(s), "scene");
});

test("base64 → bytes (standard, url-safe, data: prefix)", () => {
  assert.deepEqual(Array.from(A.base64ToBytes("AAEC/w==")), [0, 1, 2, 255]);
  assert.deepEqual(Array.from(A.base64ToBytes("data:image/jpeg;base64,AAEC_w")), [0, 1, 2, 255]);
  assert.deepEqual(Array.from(A.base64ToBytes("aGVs\nbG8=")), Array.from(new TextEncoder().encode("hello")));
  assert.throws(() => A.base64ToBytes("**"));
});

test("camera verdict: both scenes pass; errors fail with side; dark skips; retry rule", () => {
  const scene = { status: "ok" as const, stats: { mean: 110, std: 31, w: 32, h: 24 } };
  const dark = { status: "ok" as const, stats: { mean: 4, std: 1.2, w: 32, h: 24 } };
  const err = { status: "error" as const, message: "Camera is in use" };
  assert.equal(A.cameraVerdict(scene, scene, 1).outcome, "pass");
  const f = A.cameraVerdict(scene, err, 1);
  assert.equal(f.outcome, "fail");
  assert.equal(f.detail.side, "front");
  assert.equal(A.cameraVerdict(err, err, 1).detail.side, "both");
  const s = A.cameraVerdict(dark, scene, 2);
  assert.equal(s.outcome, "skip");
  assert.equal(s.detail.unclearSide, "rear");
  assert.match(String(s.detail.reason), /rear camera saw only darkness/);
  assert.equal(A.cameraVerdict({ status: "timeout" }, scene, 2).outcome, "skip");
  assert.equal(A.cameraNeedsRetry(dark, scene), true);
  assert.equal(A.cameraNeedsRetry(scene, scene), false);
  assert.equal(A.cameraNeedsRetry(err, dark), false);
});

test("flash verdict: +15% and a real delta passes; bright scene / no change skip; torch error fails", () => {
  const st = (mean: number) => ({ mean, std: 5, w: 32, h: 24 });
  assert.equal(A.flashVerdict(st(12), st(95), null).outcome, "pass");
  assert.equal(A.flashVerdict(st(4), st(6), null).outcome, "skip"); // +50% but only 2 levels: noise
  assert.equal(A.flashVerdict(st(100), st(104), null).outcome, "skip");
  assert.equal(A.flashVerdict(st(200), st(240), null).detail.reason, "the scene was already bright");
  assert.equal(A.flashVerdict(null, null, "torch unavailable").outcome, "fail");
});
