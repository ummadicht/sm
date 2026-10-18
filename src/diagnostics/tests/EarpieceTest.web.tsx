// Browser version of the earpiece test: a web page can only play sound through
// the phone's normal output (the loudspeaker, or headphones) — it cannot route
// audio to the small call speaker at the top. So a browser can't test it.
import React from "react";
import { TestProps } from "../TestShell";
import { CantTest } from "../web/WebParts";

export function EarpieceTest(p: TestProps) {
  return <CantTest p={p} reason="Browsers can't use the call speaker." />;
}
