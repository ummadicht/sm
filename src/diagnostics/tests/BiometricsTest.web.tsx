// Browser version of the fingerprint / face unlock test. A web page can only
// reach the fingerprint or face sensor through a passkey (WebAuthn), which
// means creating a credential on the customer's phone — not acceptable for a
// trade-in check. So the browser reports "can't test". Whether the phone HAS a
// built-in unlock method is recorded as evidence (it is not a sensor test).
import React, { useEffect, useState } from "react";
import { TestProps } from "../TestShell";
import { CantTest } from "../web/WebParts";

type PKC = { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> };

export function BiometricsTest(p: TestProps) {
  const [platformUnlock, setPlatformUnlock] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const api = (globalThis as unknown as { PublicKeyCredential?: PKC }).PublicKeyCredential;
    if (api && typeof api.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      api.isUserVerifyingPlatformAuthenticatorAvailable().then((v) => alive && setPlatformUnlock(v), () => {});
    }
    return () => { alive = false; };
  }, []);
  return (
    <CantTest
      p={p}
      reason="A web page can't use the fingerprint or face sensor without saving a passkey on your phone."
      detail={{ platformUnlockReported: platformUnlock }}
    />
  );
}
