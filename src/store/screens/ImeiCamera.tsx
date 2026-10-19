// The IMEI card's camera, on the tablet (native). The customer dials *#06#; then
//   Scan             this tablet's back camera reads the barcodes on that screen (or on the box):
//                    IMEI 1, and IMEI 2 when a second distinct one shows within a few seconds
//                    (../imei.ts takeScan — only a 15-digit run that passes the check digit);
//   Read the screen  one photo of it for the server's reader (POST /api/imei/read), for a *#06#
//                    screen with no barcode (an iPhone). The card asks the advisor to confirm it.
// The camera runs only while this panel is open. The browser twin is ./ImeiCamera.web.tsx (no
// barcode scan there: a photo through the browser's own camera).
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as FS from "expo-file-system/legacy";
import { Notice } from "../../shared/kit";
import { JPEG_QUALITY, MAX_DATA_URL_CHARS, MAX_EDGE_PX, fitWithin } from "../../check/battery";
import { IMEI2_WAIT_MS, IMEI_BARCODE_TYPES, NOTHING_SCANNED, type Scanned, takeScan } from "../imei";
import { Body, Btn, L } from "../ui";

export type ImeiCameraProps = {
  disabled?: boolean;
  /** The photo is with the reader. */
  reading: boolean;
  /** The camera read IMEI 1 (and IMEI 2 when the phone shows both). */
  onScanned: (s: Scanned) => void;
  /** A photo of the *#06# screen as a JPEG data URL, for the server's reader. */
  onPhoto: (dataUrl: string) => void;
  /** No photo after all (no camera, unreadable): the card says it. */
  onError: (text: string) => void;
};

/** The photo the reader gets: the longest side at most 1600 px, JPEG — the same size rule as the battery screenshot. */
async function photoDataUrl(uri: string, w: number, h: number): Promise<string | null> {
  let ctx = ImageManipulator.manipulate(uri);
  const size = fitWithin(w, h, MAX_EDGE_PX);
  if (size) ctx = ctx.resize(size);
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ base64: true, format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  // Only the data URL leaves this function: neither picture is kept on the tablet.
  FS.deleteAsync(out.uri, { idempotent: true }).catch(() => {});
  FS.deleteAsync(uri, { idempotent: true }).catch(() => {});
  return out.base64 ? `data:image/jpeg;base64,${out.base64}` : null;
}

export function ImeiCamera({ disabled, reading, onScanned, onPhoto, onError }: ImeiCameraProps) {
  const [open, setOpen] = useState<"scan" | "read" | null>(null);
  if (!open) {
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Btn title="Scan" onPress={() => setOpen("scan")} disabled={disabled || reading} />
        <Btn title="Read the screen" kind="secondary" onPress={() => setOpen("read")} busy={reading} disabled={disabled} />
      </View>
    );
  }
  return (
    <CameraPanel
      read={open === "read"}
      onScanned={(s) => {
        setOpen(null);
        onScanned(s);
      }}
      onPhoto={(url) => {
        setOpen(null);
        onPhoto(url);
      }}
      onError={(t) => {
        setOpen(null);
        onError(t);
      }}
      onStop={() => setOpen(null)}
    />
  );
}

function CameraPanel({
  read,
  onScanned,
  onPhoto,
  onError,
  onStop,
}: {
  /** Opened by "Read the screen": the photo is the main button. Barcodes are read either way. */
  read: boolean;
  onScanned: (s: Scanned) => void;
  onPhoto: (dataUrl: string) => void;
  onError: (text: string) => void;
  onStop: () => void;
}) {
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [note, setNote] = useState<string | null>(null);
  const [got, setGot] = useState<Scanned>(NOTHING_SCANNED);
  const [snapping, setSnapping] = useState(false);
  const scanned = useRef<Scanned>(NOTHING_SCANNED);
  const done = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ask once per opening: a "deny" must not bring the prompt straight back.
  const asked = useRef(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!perm || perm.granted || !perm.canAskAgain || asked.current) return;
    asked.current = true;
    setAsking(true);
    requestPerm()
      .catch(() => null)
      .finally(() => setAsking(false));
  }, [perm, requestPerm]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const finish = () => {
    if (done.current || !scanned.current.imei) return;
    done.current = true;
    if (timer.current) clearTimeout(timer.current);
    onScanned(scanned.current);
  };

  async function snap() {
    if (snapping || done.current) return;
    setSnapping(true);
    try {
      const pic = await cam.current?.takePictureAsync({ quality: 0.8, exif: false, shutterSound: false });
      if (!pic?.uri) throw new Error("no picture");
      const url = await photoDataUrl(pic.uri, pic.width, pic.height);
      if (!url || url.length > MAX_DATA_URL_CHARS) throw new Error("unreadable");
      done.current = true;
      onPhoto(url);
    } catch {
      onError("Couldn't take the photo — scan or type the IMEI.");
    } finally {
      setSnapping(false);
    }
  }

  if (!perm || asking || (!perm.granted && perm.canAskAgain && !asked.current)) return <Body muted>Opening the camera…</Body>;
  if (!perm.granted) {
    return (
      <View style={{ gap: 10 }}>
        <Notice tone="warn">No camera access — type the IMEI instead.</Notice>
        <Btn title="Type it instead" kind="ghost" onPress={onStop} style={{ alignSelf: "flex-start" }} />
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <Body muted>{read ? "Fill the frame with the *#06# screen." : "Point at the IMEI barcode."}</Body>
      <View style={{ height: 260, borderRadius: L.radius, overflow: "hidden", backgroundColor: "#000" }}>
        <CameraView
          ref={cam}
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: [...IMEI_BARCODE_TYPES] }}
          onBarcodeScanned={({ data }) => {
            if (done.current) return;
            const r = takeScan(scanned.current, String(data ?? ""));
            if (r.note) setNote(r.note);
            if (r.next === scanned.current) return; // nothing new
            const first = !scanned.current.imei;
            scanned.current = r.next;
            setGot(r.next);
            setNote(null);
            if (r.next.imei2) finish();
            // IMEI 1 is in: a dual-SIM phone shows IMEI 2 just below it — a moment to catch it too.
            else if (first) timer.current = setTimeout(finish, IMEI2_WAIT_MS);
          }}
        />
      </View>
      {got.imei ? <Notice tone="pass">{`IMEI 1 ${got.imei} — looking for IMEI 2…`}</Notice> : note ? <Notice tone="warn">{note}</Notice> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {got.imei ? (
          <Btn title="Done" onPress={finish} />
        ) : (
          <Btn title="Read the screen" kind={read ? "primary" : "secondary"} onPress={() => void snap()} busy={snapping} />
        )}
        <Btn title="Stop" kind="ghost" onPress={onStop} disabled={snapping} />
      </View>
    </View>
  );
}
