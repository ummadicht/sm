import React from "react";
import { TestProps } from "../TestShell";
import { TouchTest } from "./TouchTest";
import { MultiTouchTest } from "./MultiTouchTest";
import { DisplayTest } from "./DisplayTest";
import { MotionTest } from "./MotionTest";
import { MicTest } from "./MicTest";
import { SpeakerTest } from "./SpeakerTest";
import { EarpieceTest } from "./EarpieceTest";
import { CameraTest } from "./CameraTest";
import { FlashTest } from "./FlashTest";
import { BiometricsTest } from "./BiometricsTest";
import { VibrationTest } from "./VibrationTest";
import { ButtonsTest } from "./ButtonsTest";
import { BatteryTest } from "./BatteryTest";
import { ChargingTest } from "./ChargingTest";
import { ConnectivityTest } from "./ConnectivityTest";
import { SensorsTest } from "./SensorsTest";
import { ConfirmTest } from "./ConfirmTest";

export const TEST_COMPONENTS: Record<string, React.ComponentType<TestProps>> = {
  touch: TouchTest,
  multitouch: MultiTouchTest,
  display: DisplayTest,
  motion: MotionTest,
  mic: MicTest,
  speaker: SpeakerTest,
  voice: EarpieceTest,
  camera: CameraTest,
  flash: FlashTest,
  faceid: BiometricsTest,
  vibration: VibrationTest,
  buttons: ButtonsTest,
  battery: BatteryTest,
  charging: ChargingTest,
  connectivity: ConnectivityTest,
  sensors: SensorsTest,
  bluetooth: ConfirmTest,
  nfc: ConfirmTest,
};
