// The QR module matrix for the printable counter QR (./counterPoster.ts). The
// `qrcode` package is the same one ./QR.tsx draws with, so paper and screen encode
// exactly the same code. ./QR installs the TextEncoder fallback qrcode needs.
import QRCode from "qrcode";
import "./QR";
import type { QrMatrix } from "./counterPoster";

export function qrMatrix(value: string): QrMatrix {
  const m = QRCode.create(value, { errorCorrectionLevel: "M" }).modules;
  return { size: m.size, dark: (row, col) => !!m.get(row, col) };
}
