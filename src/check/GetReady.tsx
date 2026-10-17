// Native SwapUp Check, the first Test screen (after Identify, Scan and the battery
// step): ask for the permissions the automatic tests need (camera, microphone,
// location) and move straight on.
// No buttons to press — each system dialog only appears if the customer hasn't
// answered it before, and the tests start the moment the dialogs are done.
// The tests only READ these permissions (src/diagnostics/auto/*), so they must
// be asked here, before the runner starts.
import React, { useEffect, useRef } from "react";
import { ActivityIndicator } from "react-native";
import { Camera } from "expo-camera";
import { requestRecordingPermissionsAsync } from "expo-audio";
import * as Location from "expo-location";
import { P } from "../shared/theme";
import { Caption, ChecklistArt, Headline, Hero, Lead, QuietLink, Screen } from "../shared/kit";
import type { CheckState } from "./core";

type Perm = "camera" | "microphone" | "location";
const NEEDS: Record<string, Perm> = { camera: "camera", flash: "camera", speaker: "microphone", mic: "microphone", voice: "microphone", connectivity: "location" };

/**
 * Ask for the permissions the tests need (all of them, or only those `testIds`
 * need). Each dialog appears only if Android can still show it. Returns the
 * permissions that stay off and can no longer be asked for — those need Settings.
 */
export async function askTestPermissions(testIds?: string[]): Promise<Perm[]> {
  const want = new Set<Perm>(testIds ? testIds.map((id) => NEEDS[id]).filter((p): p is Perm => !!p) : ["camera", "microphone", "location"]);
  const blocked: Perm[] = [];
  const ask = async (p: Perm, f: () => Promise<{ granted: boolean; canAskAgain?: boolean }>) => {
    if (!want.has(p)) return;
    const r = await f().catch(() => null);
    if (r && !r.granted && r.canAskAgain === false) blocked.push(p);
  };
  await ask("camera", () => Camera.requestCameraPermissionsAsync());
  await ask("microphone", () => requestRecordingPermissionsAsync());
  await ask("location", () => Location.requestForegroundPermissionsAsync());
  return blocked;
}

export function GetReady({ state, onReady, onWrongCode }: { state: CheckState; onReady: () => void; onWrongCode: () => void }) {
  const done = useRef(onReady);
  done.current = onReady;
  useEffect(() => {
    let alive = true;
    askTestPermissions().finally(() => {
      if (alive) done.current();
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Screen
      footer={
        <>
          <QuietLink title="Wrong store? Use another code" onPress={onWrongCode} />
          <Caption style={{ marginTop: 0 }}>Trade-in {state.session.caseRef}</Caption>
        </>
      }
    >
      <Headline>Testing your phone</Headline>
      <Lead>Allow the camera, microphone and location when asked — then everything runs by itself.</Lead>
      <Hero>
        <ChecklistArt width={120} ticked={1} />
        <ActivityIndicator color={P.primary} size="large" style={{ marginTop: 26 }} />
      </Hero>
      <Caption>
        Nothing personal is read. No photos, contacts, messages, accounts or location leave this phone — only the test results, the phone model and its storage size.
      </Caption>
    </Screen>
  );
}
