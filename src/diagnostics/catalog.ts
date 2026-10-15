// The functional-test catalog. Test ids and names are kept IDENTICAL to the
// GradeIQ web app's lib/tests.ts so a mobile report exports into the same
// SuperIQ /api/diagnostics ingest contract with no mapping layer. Tests that
// only a native app can run (battery, charging port, connectivity, sensors,
// biometrics, flashlight, NFC, Bluetooth) are additive.
import { Platform as RNPlatform } from "react-native";

export type Platform = "all" | "android" | "ios";
export type Result = "pass" | "fail" | "skip";
export type Results = Record<string, Result>;

export type FunctionalTest = {
  id: string;
  name: string;
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
  { id: "touch", name: "Touchscreen", game: "Clear every square", emoji: "▦", api: "RN touch responder grid", mode: "auto", critical: true, platform: "all" },
  { id: "multitouch", name: "Multi-touch", game: "Three fingers down", emoji: "✋", api: "nativeEvent.touches", mode: "auto", critical: false, platform: "all" },
  { id: "display", name: "Display / dead pixels", game: "Spot the defect", emoji: "🎨", api: "Full-screen fills + expo-brightness", mode: "confirm", critical: true, platform: "all" },
  { id: "motion", name: "Gyroscope / accelerometer", game: "Roll the ball home", emoji: "🎯", api: "expo-sensors Accelerometer", mode: "auto", critical: false, platform: "all" },
  { id: "mic", name: "Microphone", game: "Blow out the candles", emoji: "🕯️", api: "expo-audio recorder metering", mode: "auto", critical: true, platform: "all" },
  { id: "speaker", name: "Speaker", game: "Count the beeps", emoji: "🔊", api: "expo-audio player", mode: "auto", critical: true, platform: "all" },
  { id: "voice", name: "Earpiece", game: "Hear the sweep", emoji: "📞", api: "expo-audio (earpiece route)", mode: "confirm", critical: false, platform: "all" },
  { id: "camera", name: "Cameras (front + rear)", game: "Shoot both sides", emoji: "📷", api: "expo-camera CameraView", mode: "confirm", critical: true, platform: "all" },
  { id: "flash", name: "Flashlight", game: "Light it up", emoji: "🔦", api: "expo-camera enableTorch", mode: "confirm", critical: false, platform: "all" },
  { id: "faceid", name: "Biometrics", game: "Unlock it", emoji: "🪪", api: "expo-local-authentication", mode: "auto", critical: false, platform: "all" },
  { id: "vibration", name: "Vibration motor", game: "Feel the buzz", emoji: "📳", api: "Vibration + expo-haptics", mode: "confirm", critical: false, platform: "all" },
  { id: "buttons", name: "Hardware buttons", game: "Press them all", emoji: "🔘", api: "BackHandler (Android) + confirm", mode: "confirm", critical: false, platform: "all" },
  { id: "battery", name: "Battery", game: "Read the gauge", emoji: "🔋", api: "expo-battery", mode: "auto", critical: false, platform: "all" },
  { id: "charging", name: "Charging port", game: "Plug it in", emoji: "🔌", api: "expo-battery state listener", mode: "auto", critical: true, platform: "all" },
  { id: "connectivity", name: "Wi-Fi / cellular / GPS", game: "Find a signal", emoji: "📡", api: "expo-network · expo-cellular · expo-location", mode: "auto", critical: false, platform: "all" },
  { id: "sensors", name: "Compass / light / barometer", game: "Sensor roll-call", emoji: "🧭", api: "expo-sensors", mode: "auto", critical: false, platform: "all" },
  { id: "bluetooth", name: "Bluetooth", game: "Find a neighbour", emoji: "🟦", api: "Settings (no Expo Go module)", mode: "confirm", critical: false, platform: "all" },
  { id: "nfc", name: "NFC", game: "Tap a card", emoji: "💳", api: "Settings (no Expo Go module)", mode: "confirm", critical: false, platform: "all" },
];

export function testsForThisDevice(): FunctionalTest[] {
  const os = RNPlatform.OS === "ios" ? "ios" : "android";
  return FUNCTIONAL_TESTS.filter((t) => t.platform === "all" || t.platform === os);
}

export function testById(id: string): FunctionalTest | undefined {
  return FUNCTIONAL_TESTS.find((t) => t.id === id);
}
