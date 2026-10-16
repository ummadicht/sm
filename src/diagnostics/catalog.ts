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
  /** auto = the app decides; confirm = the tester confirms with their eyes/ears. */
  mode: "auto" | "confirm";
  /** A failing critical test grades the device "Faulty" regardless of the rest. */
  critical: boolean;
  platform: Platform;
};

export const FUNCTIONAL_TESTS: FunctionalTest[] = [
  { id: "touch", name: "Touchscreen", title: "Touchscreen", game: "Clear every square", emoji: "▦", api: "RN touch responder grid", web: "Pointer Events on the grid (touch-action:none)", mode: "auto", critical: true, platform: "all" },
  { id: "multitouch", name: "Multi-touch", title: "Several fingers at once", game: "Three fingers down", emoji: "✋", api: "nativeEvent.touches", web: "TouchEvent.touches; screens with < 3 touch points → unsupported", mode: "auto", critical: false, platform: "all" },
  { id: "display", name: "Display / dead pixels", title: "Screen colours", game: "Spot the defect", emoji: "🎨", api: "Full-screen fills + expo-brightness", web: "Full-screen fills (Fullscreen API where allowed); brightness is up to the customer", mode: "confirm", critical: true, platform: "all" },
  { id: "motion", name: "Gyroscope / accelerometer", title: "Tilt sensor", game: "Roll the ball home", emoji: "🎯", api: "expo-sensors Accelerometer", web: "DeviceOrientation + DeviceMotion (iOS: tap to allow); no data in 3 s → unsupported", mode: "auto", critical: false, platform: "all" },
  { id: "mic", name: "Microphone", title: "Microphone", game: "Blow out the candles", emoji: "🕯️", api: "expo-audio recorder metering", web: "getUserMedia(audio) + Web Audio AnalyserNode RMS", mode: "auto", critical: true, platform: "all" },
  { id: "speaker", name: "Speaker", title: "Loudspeaker", game: "Count the beeps", emoji: "🔊", api: "expo-audio player", web: "Synthesised beeps played through an <audio> element", mode: "auto", critical: true, platform: "all" },
  { id: "voice", name: "Earpiece", title: "Call speaker (earpiece)", game: "Hear the sweep", emoji: "📞", api: "expo-audio (earpiece route)", web: "unsupported — a browser can't route sound to the earpiece", mode: "confirm", critical: false, platform: "all" },
  { id: "camera", name: "Cameras (front + rear)", title: "Cameras", game: "Shoot both sides", emoji: "📷", api: "expo-camera CameraView", web: "getUserMedia environment/user + canvas capture; detail.side when one fails", mode: "confirm", critical: true, platform: "all" },
  { id: "flash", name: "Flashlight", title: "Flashlight", game: "Light it up", emoji: "🔦", api: "expo-camera enableTorch", web: "MediaStreamTrack torch constraint (Chrome Android); no torch capability → unsupported", mode: "confirm", critical: false, platform: "all" },
  { id: "faceid", name: "Biometrics", title: "Fingerprint / face unlock", game: "Unlock it", emoji: "🪪", api: "expo-local-authentication", web: "unsupported — reaching the sensor needs a WebAuthn credential", mode: "auto", critical: false, platform: "all" },
  { id: "vibration", name: "Vibration motor", title: "Vibration", game: "Feel the buzz", emoji: "📳", api: "Vibration + expo-haptics", web: "navigator.vibrate (Chrome Android); absent or refused → unsupported", mode: "confirm", critical: false, platform: "all" },
  { id: "buttons", name: "Hardware buttons", title: "Side buttons", game: "Press them all", emoji: "🔘", api: "BackHandler (Android) + confirm", web: "Customer tick-list; the screen locking is observed via visibilitychange", mode: "confirm", critical: false, platform: "all" },
  { id: "battery", name: "Battery", title: "Battery", game: "Read the gauge", emoji: "🔋", api: "expo-battery", web: "navigator.getBattery (Chrome); absent → unsupported", mode: "auto", critical: false, platform: "all" },
  { id: "charging", name: "Charging port", title: "Charging port", game: "Plug it in", emoji: "🔌", api: "expo-battery state listener", web: "Battery API chargingchange; absent → unsupported", mode: "auto", critical: true, platform: "all" },
  { id: "connectivity", name: "Wi-Fi / cellular / GPS", title: "Wi‑Fi and mobile network", game: "Find a signal", emoji: "📡", api: "expo-network · expo-cellular · expo-location", web: "Same-origin reachability + navigator.connection + Geolocation; SIM not visible", mode: "auto", critical: false, platform: "all" },
  { id: "sensors", name: "Compass / light / barometer", title: "Compass", game: "Sensor roll-call", emoji: "🧭", api: "expo-sensors", web: "deviceorientationabsolute / webkitCompassHeading; light + barometer not in browsers", mode: "auto", critical: false, platform: "all" },
  { id: "bluetooth", name: "Bluetooth", title: "Bluetooth", game: "Find a neighbour", emoji: "🟦", api: "Settings (no Expo Go module)", web: "Web Bluetooth getAvailability (Chrome); absent → unsupported", mode: "confirm", critical: false, platform: "all" },
  { id: "nfc", name: "NFC", title: "NFC (tap to pay)", game: "Tap a card", emoji: "💳", api: "Settings (no Expo Go module)", web: "Web NFC NDEFReader scan (Chrome Android); absent → unsupported", mode: "confirm", critical: false, platform: "all" },
];

export function testsForThisDevice(): FunctionalTest[] {
  const os = RNPlatform.OS === "ios" ? "ios" : "android";
  return FUNCTIONAL_TESTS.filter((t) => t.platform === "all" || t.platform === os);
}

export function testById(id: string): FunctionalTest | undefined {
  return FUNCTIONAL_TESTS.find((t) => t.id === id);
}
