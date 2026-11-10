import React, { useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { TestProps, TestShell } from "../TestShell";
import { Btn } from "../../shared/ui";
import { T } from "../../shared/theme";

// Rear then front: capture a frame from each, show it back, tester judges
// focus / spots / colour cast. Which lens produced a frame is recorded.
export function CameraTest(p: TestProps) {
  const [perm, request] = useCameraPermissions();
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [shots, setShots] = useState<{ back?: string; front?: string }>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const cam = useRef<CameraView>(null);

  const snap = async () => {
    if (!cam.current || busy) return;
    setBusy(true);
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.3, skipProcessing: true });
      if (pic?.uri) {
        setShots((s) => ({ ...s, [facing]: pic.uri }));
        if (facing === "back") { setReady(false); setFacing("front"); }
      }
    } catch { /* fall through; tester can fail it */ }
    setBusy(false);
  };

  const both = !!shots.back && !!shots.front;
  if (!perm) return <TestShell {...p} instructions="Requesting camera…"><View /></TestShell>;
  if (!perm.granted) {
    return (
      <TestShell {...p} instructions="Camera permission is required for this test." autoVerdict="skip" detail={{ permission: "denied" }}>
        <View style={{ flex: 1, justifyContent: "center" }}><Btn title="Allow camera" onPress={() => request()} /></View>
      </TestShell>
    );
  }
  return (
    <TestShell {...p} instructions={both ? "Check both frames: sharp focus, no black spots, no colour cast, no cracks visible through the lens." : `Point the ${facing === "back" ? "REAR" : "FRONT"} camera at something detailed and capture.`} detail={{ rearCaptured: !!shots.back, frontCaptured: !!shots.front }}>
      <View style={{ flex: 1, gap: 10 }}>
        {!both && (
          <CameraView ref={cam} style={s.cam} facing={facing} onCameraReady={() => setReady(true)} />
        )}
        {!both && <Btn title={busy ? "Capturing…" : `Capture ${facing === "back" ? "rear" : "front"}`} onPress={snap} disabled={!ready || busy} />}
        <View style={{ flexDirection: "row", gap: 10 }}>
          {(["back", "front"] as const).map((f) => (
            <View key={f} style={s.thumbWrap}>
              {shots[f] ? <Image source={{ uri: shots[f] }} style={s.thumb} /> : <View style={[s.thumb, { alignItems: "center", justifyContent: "center" }]}><Text style={{ color: T.muted }}>{f}</Text></View>}
              <Text style={s.cap}>{f === "back" ? "Rear" : "Front"} {shots[f] ? "✓" : ""}</Text>
            </View>
          ))}
        </View>
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({
  cam: { flex: 1, borderRadius: T.radius, overflow: "hidden", backgroundColor: "#000" },
  thumbWrap: { flex: 1, gap: 4 },
  thumb: { height: 110, borderRadius: 10, backgroundColor: T.surface2 },
  cap: { color: T.muted, fontSize: 12, textAlign: "center" },
});
