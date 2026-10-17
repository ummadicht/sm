// Native SwapUp Check, first screen after joining: ask for the permissions the
// automatic tests need (camera, microphone, location) and move straight on.
// No buttons to press — each system dialog only appears if the customer hasn't
// answered it before, and the tests start the moment the dialogs are done.
// The tests only READ these permissions (src/diagnostics/auto/*), so they must
// be asked here, before the runner starts.
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Camera } from "expo-camera";
import { requestRecordingPermissionsAsync } from "expo-audio";
import * as Location from "expo-location";
import { T } from "../shared/theme";
import { Big, Say } from "../diagnostics/parts";
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
    <View style={s.root}>
      <Text style={s.kicker}>{state.session.storeName}</Text>
      <Text style={s.title}>Testing your phone</Text>
      <Say>Allow the camera, microphone and location when asked — then everything runs by itself.</Say>
      <ActivityIndicator color={T.accent} size="large" style={{ marginVertical: 28 }} />
      <Text style={s.privacy}>
        Nothing personal is read. No photos, contacts, messages, accounts or location leave this phone — only the test results, the phone model and its storage size.
      </Text>
      <View style={{ flex: 1 }} />
      <Big title="Wrong store? Use another code" kind="quiet" onPress={onWrongCode} />
      <Text style={s.small}>Trade-in {state.session.caseRef}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg, padding: 22, paddingTop: 30 },
  kicker: { color: T.accent, fontSize: 14, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 },
  title: { color: T.text, fontSize: 30, fontWeight: "800", lineHeight: 36, marginBottom: 10 },
  privacy: { color: T.muted, fontSize: 14, lineHeight: 20, marginTop: 14 },
  small: { color: T.muted, fontSize: 14, textAlign: "center", marginTop: 8 },
});
