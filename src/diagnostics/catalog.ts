// The functional-test catalog. Test ids and names are kept IDENTICAL to the
// GradeIQ web app's lib/tests.ts so a mobile report exports into the same
// SuperIQ /api/diagnostics ingest contract with no mapping layer. Tests that
// only a native app can run (battery, charging port, connectivity, sensors,
// biometrics, flashlight, NFC, Bluetooth) are additive.
import { Platform as RNPlatform } from "react-native";

export type Platform = "all" | "android" | "ios";
/** "unsupported" = this phone has no such hardware, or this app can't run the test. Never a pass. */
export type Result = "pass" | "fail" | "skip" | "unsupported";
export type Results = Record<string, Result>;

export type FunctionalTest = {
  id: string;
  name: string;
  /** What the customer sees — plain words, no jargon. `name` stays identical to the server plan. */
  title: string;
  /** The gamified framing shown to the tester. */
  game: string;
  emoji: string;
  /** Which native API backs it — documented for honesty about coverage. */
  api: string;
  /** What the browser build (tests/*.web.tsx) uses instead, and when it reports "unsupported". */
  web?: string;
  /** How the NATIVE app decides it with no questions (diagnostics/auto, docs/AUTO-TESTS.md). */
  auto?: string;
  /** auto = the app decides; confirm = the tester confirms with their eyes/ears. */
  mode: "auto" | "confirm";
  /** A failing critical test grades the device "Faulty" regardless of the rest. */
  critical: boolean;
  platform: Platform;
};

export const FUNCTIONAL_TESTS: FunctionalTest[] = [
  { id: "touch", name: "Touchscreen", title: "Touchscreen", game: "Clear every square", emoji: "▦", api: "RN touch responder grid", web: "Pointer Events on the grid (touch-action:none)", auto: "ACTION: swipe grid; cleared = pass, dead squares the finger kept reaching = fail, else not tested", mode: "auto", critical: true, platform: "all" },
  { id: "multitouch", name: "Multi-touch", title: "Several fingers at once", game: "Three fingers down", emoji: "✋", api: "nativeEvent.touches", web: "TouchEvent.touches; screens with < 3 touch points → unsupported", auto: "not in the automatic run (skip)", mode: "auto", critical: false, platform: "all" },
  { id: "display", name: "Display / dead pixels", title: "Screen colours", game: "Spot the defect", emoji: "🎨", api: "Full-screen fills + expo-brightness", web: "Full-screen fills (Fullscreen API where allowed); brightness is up to the customer", auto: "not posted by the phone: GradeIQ’s camera LCD sweep decides on the server", mode: "confirm", critical: true, platform: "all" },
  { id: "motion", name: "Gyroscope / accelerometer", title: "Tilt sensor", game: "Roll the ball home", emoji: "🎯", api: "expo-sensors Accelerometer", web: "DeviceOrientation + DeviceMotion (iOS: tap to allow); no data in 3 s → unsupported", auto: "accelerometer + gyroscope 1.5 s; gravity ≈ 9.8 m/s² ±25%", mode: "auto", critical: false, platform: "all" },
  { id: "mic", name: "Microphone", title: "Microphone", game: "Blow out the candles", emoji: "🕯️", api: "expo-audio recorder metering", web: "getUserMedia(audio) + Web Audio AnalyserNode RMS", auto: "recorder metering during the loopback tone; level moves ≥ 6 dB", mode: "auto", critical: true, platform: "all" },
  { id: "speaker", name: "Speaker", title: "Loudspeaker", game: "Count the beeps", emoji: "🔊", api: "expo-audio player", web: "Synthesised beeps played through an <audio> element", auto: "speaker→mic loopback, correlation with the tone pattern ≥ 0.6", mode: "auto", critical: true, platform: "all" },
  { id: "voice", name: "Earpiece", title: "Call speaker (earpiece)", game: "Hear the sweep", emoji: "📞", api: "expo-audio (earpiece route)", web: "unsupported — a browser can't route sound to the earpiece", auto: "earpiece→mic loopback (Android earpiece route) ≥ 0.5, quieter than the loudspeaker", mode: "confirm", critical: false, platform: "all" },
  { id: "camera", name: "Cameras (front + rear)", title: "Cameras", game: "Shoot both sides", emoji: "📷", api: "expo-camera CameraView", web: "getUserMedia environment/user + canvas capture; detail.side when one fails", auto: "rear + front capture → 32 px → luminance std-dev ≥ 6; detail.side on failure", mode: "confirm", critical: true, platform: "all" },
  { id: "flash", name: "Flashlight", title: "Flashlight", game: "Light it up", emoji: "🔦", api: "expo-camera enableTorch", web: "MediaStreamTrack torch constraint (Chrome Android); no torch capability → unsupported", auto: "rear frame torch off vs on, +15%", mode: "confirm", critical: false, platform: "all" },
  { id: "faceid", name: "Biometrics", title: "Fingerprint / face unlock", game: "Unlock it", emoji: "🪪", api: "expo-local-authentication", web: "unsupported — reaching the sensor needs a WebAuthn credential", auto: "always skip: hardware/enrolled reported, exercising it needs the owner", mode: "auto", critical: false, platform: "all" },
  { id: "vibration", name: "Vibration motor", title: "Vibration", game: "Feel the buzz", emoji: "📳", api: "Vibration + expo-haptics", web: "navigator.vibrate (Chrome Android); absent or refused → unsupported", auto: "accelerometer std-dev during Vibration.vibrate ≥ 2.5× before", mode: "confirm", critical: false, platform: "all" },
  { id: "buttons", name: "Hardware buttons", title: "Side buttons", game: "Press them all", emoji: "🔘", api: "BackHandler (Android) + confirm", web: "Customer tick-list; the screen locking is observed via visibilitychange", auto: "not in the automatic run (skip)", mode: "confirm", critical: false, platform: "all" },
  { id: "battery", name: "Battery", title: "Battery", game: "Read the gauge", emoji: "🔋", api: "expo-battery", web: "navigator.getBattery (Chrome); absent → unsupported", auto: "expo-battery level read", mode: "auto", critical: false, platform: "all" },
  { id: "charging", name: "Charging port", title: "Charging port", game: "Plug it in", emoji: "🔌", api: "expo-battery state listener", web: "Battery API chargingchange; absent → unsupported", auto: "ACTION: already charging = pass, else 45 s for a charger, then not tested", mode: "auto", critical: true, platform: "all" },
  { id: "connectivity", name: "Wi-Fi / cellular / GPS", title: "Wi‑Fi and mobile network", game: "Find a signal", emoji: "📡", api: "expo-network · expo-cellular · expo-location", web: "Same-origin reachability + navigator.connection + Geolocation; SIM not visible", auto: "network state + SIM + 10 s GPS fix", mode: "auto", critical: false, platform: "all" },
  { id: "sensors", name: "Compass / light / barometer", title: "Compass", game: "Sensor roll-call", emoji: "🧭", api: "expo-sensors", web: "deviceorientationabsolute / webkitCompassHeading; light + barometer not in browsers", auto: "magnetometer 1.5 s varying; light + barometer reported", mode: "auto", critical: false, platform: "all" },
  { id: "bluetooth", name: "Bluetooth", title: "Bluetooth", game: "Find a neighbour", emoji: "🟦", api: "Settings (no Expo Go module)", web: "Web Bluetooth getAvailability (Chrome); absent → unsupported", auto: "Android feature list; absent = unsupported", mode: "confirm", critical: false, platform: "all" },
  { id: "nfc", name: "NFC", title: "NFC (tap to pay)", game: "Tap a card", emoji: "💳", api: "Settings (no Expo Go module)", web: "Web NFC NDEFReader scan (Chrome Android); absent → unsupported", auto: "Android feature list; absent = unsupported", mode: "confirm", critical: false, platform: "all" },
];

export function testsForThisDevice(): FunctionalTest[] {
  const os = RNPlatform.OS === "ios" ? "ios" : "android";
  return FUNCTIONAL_TESTS.filter((t) => t.platform === "all" || t.platform === os);
}

export function testById(id: string): FunctionalTest | undefined {
  return FUNCTIONAL_TESTS.find((t) => t.id === id);
}
