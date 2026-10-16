// The loopback tone, synthesised on the phone (no asset to keep in sync with
// the numbers the correlation expects): TONE_BURSTS at TONE.freqHz, 16-bit mono
// PCM WAV, short fades so the speaker doesn't click. No runtime imports — the
// numbers are passed in by the caller (auto/audio.ts) so node --test can run it.

export type ToneSpec = {
  sampleRate: number;
  freqHz: number;
  amplitude: number;
  fadeMs: number;
  lengthMs: number;
  bursts: ReadonlyArray<readonly [number, number]>;
};

/** Little-endian 16-bit mono PCM WAV of the burst pattern. */
export function toneWav(spec: ToneSpec): Uint8Array {
  const n = Math.round((spec.sampleRate * spec.lengthMs) / 1000);
  const dataBytes = n * 2;
  const buf = new Uint8Array(44 + dataBytes);
  const dv = new DataView(buf.buffer);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, spec.sampleRate, true);
  dv.setUint32(28, spec.sampleRate * 2, true); // byte rate
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  dv.setUint32(40, dataBytes, true);
  const fade = (spec.fadeMs / 1000) * spec.sampleRate;
  for (let i = 0; i < n; i++) {
    const tMs = (i / spec.sampleRate) * 1000;
    let v = 0;
    for (const [s, e] of spec.bursts) {
      if (tMs < s || tMs >= e) continue;
      const fromStart = ((tMs - s) / 1000) * spec.sampleRate;
      const toEnd = ((e - tMs) / 1000) * spec.sampleRate;
      const env = Math.min(1, fromStart / fade, toEnd / fade);
      v = spec.amplitude * env * Math.sin((2 * Math.PI * spec.freqHz * i) / spec.sampleRate);
    }
    dv.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return buf;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Bytes → standard base64 (expo-file-system writes files from base64). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + "==";
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
  }
  return out;
}
