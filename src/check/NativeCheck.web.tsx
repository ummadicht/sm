// The browser build keeps the interactive flow (./screens.tsx): CheckApp only
// renders NativeCheck when IS_WEB is false. This stub keeps the native-only
// modules (camera rig, loopback audio, jpeg-js, image manipulator, pairing
// screen) out of the web bundle.
import type { CheckEngine, Snapshot } from "./engine";

export function NativeCheck(_props: {
  engine: CheckEngine;
  snap: Snapshot;
  onBleed: (on: boolean) => void;
  onWrongCode: () => void;
  onNewCheck: () => void;
}): null {
  return null;
}
