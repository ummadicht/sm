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
  /** auto = the app decides; confirm = the tester confirms with their eyes/ears. */
  mode: "auto" | "confirm";
  /** A failing critical test grades the device "Faulty" regardless of the rest. */
  critical: boolean;
  platform: Platform;
};

export const FUNCTIONAL_TESTS: FunctionalTest[] = [
  { id: "touch", name: "Touchscreen", title: "Touchscreen", game: "Clear every square", emoji: "▦", api: "RN touch responder grid", mode: "auto", critical: true, platform: "all" },
  { id: "multitouch", name: "Multi-touch", title: "Several fingers at once", game: "Three fingers down", emoji: "✋", api: "nativeEvent.touches", mode: "auto", critical: false, platform: "all" },
  { id: "display", name: "Display / dead pixels", title: "Screen colours", game: "Spot the defect", emoji: "🎨", api: "Full-screen fills + expo-brightness", mode: "confirm", critical: true, platform: "all" },
  { id: "motion", name: "Gyroscope / accelerometer", title: "Tilt sensor", game: "Roll the ball home", emoji: "🎯", api: "expo-sensors Accelerometer", mode: "auto", critical: false, platform: "all" },
  { id: "mic", name: "Microphone", title: "Microphone", game: "Blow out the candles", emoji: "🕯️", api: "expo-audio recorder metering", mode: "auto", critical: true, platform: "all" },
  { id: "speaker", name: "Speaker", title: "Loudspeaker", game: "Count the beeps", emoji: "🔊", api: "expo-audio player", mode: "auto", critical: true, platform: "all" },
  { id: "voice", name: "Earpiece", title: "Call speaker (earpiece)", game: "Hear the sweep", emoji: "📞", api: "expo-audio (earpiece route)", mode: "confirm", critical: false, platform: "all" },
  { id: "camera", name: "Cameras (front + rear)", title: "Cameras", game: "Shoot both sides", emoji: "📷", api: "expo-camera CameraView", mode: "confirm", critical: true, platform: "all" },
  { id: "flash", name: "Flashlight", title: "Flashlight", game: "Light it up", emoji: "🔦", api: "expo-camera enableTorch", mode: "confirm", critical: false, platform: "all" },
  { id: "faceid", name: "Biometrics", title: "Fingerprint / face unlock", game: "Unlock it", emoji: "🪪", api: "expo-local-authentication", mode: "auto", critical: false, platform: "all" },
  { id: "vibration", name: "Vibration motor", title: "Vibration", game: "Feel the buzz", emoji: "📳", api: "Vibration + expo-haptics", mode: "confirm", critical: false, platform: "all" },
  { id: "buttons", name: "Hardware buttons", title: "Side buttons", game: "Press them all", emoji: "🔘", api: "BackHandler (Android) + confirm", mode: "confirm", critical: false, platform: "all" },
  { id: "battery", name: "Battery", title: "Battery", game: "Read the gauge", emoji: "🔋", api: "expo-battery", mode: "auto", critical: false, platform: "all" },
  { id: "charging", name: "Charging port", title: "Charging port", game: "Plug it in", emoji: "🔌", api: "expo-battery state listener", mode: "auto", critical: true, platform: "all" },
  { id: "connectivity", name: "Wi-Fi / cellular / GPS", title: "Wi‑Fi and mobile network", game: "Find a signal", emoji: "📡", api: "expo-network · expo-cellular · expo-location", mode: "auto", critical: false, platform: "all" },
  { id: "sensors", name: "Compass / light / barometer", title: "Compass", game: "Sensor roll-call", emoji: "🧭", api: "expo-sensors", mode: "auto", critical: false, platform: "all" },
  { id: "bluetooth", name: "Bluetooth", title: "Bluetooth", game: "Find a neighbour", emoji: "🟦", api: "Settings (no Expo Go module)", mode: "confirm", critical: false, platform: "all" },
  { id: "nfc", name: "NFC", title: "NFC (tap to pay)", game: "Tap a card", emoji: "💳", api: "Settings (no Expo Go module)", mode: "confirm", critical: false, platform: "all" },
];

export function testsForThisDevice(): FunctionalTest[] {
  const os = RNPlatform.OS === "ios" ? "ios" : "android";
  return FUNCTIONAL_TESTS.filter((t) => t.platform === "all" || t.platform === os);
}

export function testById(id: string): FunctionalTest | undefined {
  return FUNCTIONAL_TESTS.find((t) => t.id === id);
}
