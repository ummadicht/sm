// Speaker / mic / earpiece, all by loopback: the phone plays a synthesised
// three-burst tone and listens to itself with the recorder's metering. The
// verdicts (./analysis) correlate the metering with the burst pattern, so room
// noise can't pass it and nobody has to say what they heard.
// Native only (expo-audio recorder metering = Android MediaRecorder.getMaxAmplitude).
import { Platform } from "react-native";
import * as FS from "expo-file-system/legacy";
import { createAudioPlayer, getRecordingPermissionsAsync, setAudioModeAsync, type AudioPlayer, type AudioRecorder } from "expo-audio";
import {
  type Loopback,
  type MeterSample,
  type Verdict,
  TONE,
  TONE_BURSTS,
  loopbackCorrelation,
  micVerdict,
  speakerVerdict,
  voiceVerdict,
} from "./analysis";
import { bytesToBase64, toneWav } from "./tone";
import { sleep } from "./steps";

const POLL_MS = 40;
const BASELINE_MS = 600;
const TAIL_MS = 900;
/** The first readings after record() are the recorder settling (getMaxAmplitude starts at 0). */
const WARMUP_MS = 300;

let toneUri: Promise<string> | null = null;
/** Write the tone once per app run (cache dir) and hand back its file URI. */
function loopbackTone(): Promise<string> {
  if (!toneUri) {
    toneUri = (async () => {
      const dir = FS.cacheDirectory ?? FS.documentDirectory ?? "";
      const uri = dir + "swapup-loopback-v1.wav";
      const b64 = bytesToBase64(toneWav({ ...TONE, bursts: TONE_BURSTS }));
      await FS.writeAsStringAsync(uri, b64, { encoding: FS.EncodingType.Base64 });
      return uri;
    })().catch((e) => {
      toneUri = null;
      throw e;
    });
  }
  return toneUri;
}

async function waitLoaded(p: AudioPlayer, ms: number): Promise<boolean> {
  const t = Date.now() + ms;
  while (Date.now() < t) {
    if (p.isLoaded) return true;
    await sleep(50);
  }
  return p.isLoaded;
}

async function audioMode(earpiece: boolean) {
  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: true,
    ...(Platform.OS === "android" ? { shouldRouteThroughEarpiece: earpiece } : {}),
  });
}

export async function resetAudioMode() {
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, ...(Platform.OS === "android" ? { shouldRouteThroughEarpiece: false } : {}) }).catch(() => {});
}

type Run = { samples: MeterSample[] } | { error: string };

/** Record → baseline → play the tone → tail → stop. Samples are timed from the play() call. */
async function recordWhilePlaying(rec: AudioRecorder, earpiece: boolean): Promise<Run> {
  let player: AudioPlayer | null = null;
  try {
    const uri = await loopbackTone();
    await audioMode(earpiece);
    player = createAudioPlayer({ uri });
    player.volume = 1;
    if (!(await waitLoaded(player, 3000))) return { error: "the test tone did not load" };
    try {
      await rec.prepareToRecordAsync();
      rec.record();
    } catch (e) {
      return { error: `the recorder could not start: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
    }
    await sleep(WARMUP_MS);
    const samples: MeterSample[] = [];
    const t0 = Date.now() + BASELINE_MS; // when play() will be called
    const end = t0 + TONE.lengthMs + TAIL_MS;
    let played = false;
    while (Date.now() < end) {
      const now = Date.now();
      if (!played && now >= t0) {
        player.seekTo(0).catch(() => {});
        player.play();
        played = true;
      }
      const m = rec.getStatus().metering;
      if (typeof m === "number" && isFinite(m)) samples.push({ t: now - t0, db: m });
      await sleep(POLL_MS);
    }
    return { samples };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e).slice(0, 160) };
  } finally {
    try {
      player?.pause();
    } catch {
      /* already gone */
    }
    try {
      player?.release();
    } catch {
      /* already gone */
    }
    const file = rec.uri;
    await rec.stop().catch(() => {});
    // Only the level readings are used; the room recording itself is deleted at once.
    if (file) FS.deleteAsync(file, { idempotent: true }).catch(() => {});
  }
}

export type LoopbackResults = { speaker: Verdict; mic: Verdict; speakerOnDb: number | null };

/** Loudspeaker → microphone. One run answers both tests. */
export async function speakerMicStep(rec: AudioRecorder): Promise<LoopbackResults> {
  const perm = await getRecordingPermissionsAsync().catch(() => null);
  if (!perm?.granted) {
    const reason = "microphone permission refused";
    return {
      mic: { outcome: "skip", detail: { method: "recorder metering", reason } },
      speaker: { outcome: "skip", detail: { method: "speaker→mic loopback", reason: "can't listen: " + reason } },
      speakerOnDb: null,
    };
  }
  const run = await recordWhilePlaying(rec, false);
  await resetAudioMode();
  if ("error" in run) {
    return {
      mic: { outcome: "skip", detail: { method: "recorder metering", reason: run.error } },
      speaker: { outcome: "skip", detail: { method: "speaker→mic loopback", reason: "can't listen: " + run.error } },
      speakerOnDb: null,
    };
  }
  const mic = micVerdict(run.samples);
  const lb: Loopback = loopbackCorrelation(run.samples);
  const speaker = speakerVerdict(lb, mic.outcome === "pass");
  return { mic, speaker, speakerOnDb: speaker.outcome === "pass" ? lb.onDb : null };
}

/** Earpiece → microphone (Android routes it with MODE_IN_COMMUNICATION + speakerphone off). */
export async function voiceStep(rec: AudioRecorder, micWorks: boolean, speakerOnDb: number | null): Promise<Verdict> {
  const method = "earpiece→mic loopback";
  if (Platform.OS !== "android") return { outcome: "skip", detail: { method, reason: "the earpiece route is only forced on Android" } };
  const perm = await getRecordingPermissionsAsync().catch(() => null);
  if (!perm?.granted) return { outcome: "skip", detail: { method, reason: "microphone permission refused" } };
  if (!micWorks) return { outcome: "skip", detail: { method, reason: "can't listen: the microphone gave no usable signal" } };
  const run = await recordWhilePlaying(rec, true);
  await resetAudioMode();
  if ("error" in run) return { outcome: "skip", detail: { method, reason: run.error } };
  return voiceVerdict(loopbackCorrelation(run.samples), true, speakerOnDb);
}
