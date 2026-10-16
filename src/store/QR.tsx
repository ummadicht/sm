// QR codes drawn in JS: the `qrcode` package renders an SVG string and
// react-native-svg paints it. No native QR module, no network.
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import QRCode from "qrcode";
import { L } from "../shared/theme";

export function QR({ value, size }: { value: string; size: number }) {
  const [xml, setXml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setXml(null);
    setFailed(false);
    QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
      .then((svg) => {
        if (alive) setXml(svg);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [value]);

  return (
    <View
      style={{ width: size, height: size, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}
      accessible
      accessibilityLabel="QR code"
    >
      {xml ? (
        <SvgXml xml={xml} width={size} height={size} />
      ) : failed ? (
        <Text style={{ color: L.bad, fontSize: 15, textAlign: "center", padding: 12 }}>
          This QR code couldn't be drawn. Use the code or link below instead.
        </Text>
      ) : null}
    </View>
  );
}
