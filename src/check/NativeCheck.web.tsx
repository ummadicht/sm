// The browser build runs its own flow from CheckApp (Identify, Scan, battery,
// then the interactive tests in ./screens.tsx): CheckApp only renders
// NativeCheck when IS_WEB is false. This stub keeps the native-only automatic
// run (camera rig, loopback audio, jpeg-js, the permission screen) out of the
// web bundle. (The Scan, Identify and battery screens are shared — CheckApp
// imports them itself.)
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

/** Native only (the browser's finish screen is ./screens.tsx DoneScreen). */
export function NativeApplied(_props: { snap: Snapshot; onNewCheck: () => void }): null {
  return null;
}
