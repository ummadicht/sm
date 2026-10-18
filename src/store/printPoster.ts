// Print the counter QR from the tablet: a one-page PDF (./counterPoster.ts) handed
// to Android's share sheet. From there a printer app, Drive or "send to the shop
// PC" prints it — the APK has no print module, and a PDF needs none.
// Browser twin: ./printPoster.web.ts (the browser's own print dialog).
import * as FS from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { posterPdf } from "./counterPoster";
import { qrMatrix } from "./qrMatrix";

export type PrintResult = { ok: true } | { ok: false; error: string };

/** The button says what will happen: on the tablet it opens the share sheet, not a print dialog. */
export const PRINT_LABEL = "Print or share";
export const PRINT_HINT = "Shares a one-page PDF to print.";

export async function printCounterQr(p: { storeName: string; code: string; joinUrl: string }): Promise<PrintResult> {
  try {
    if (!(await Sharing.isAvailableAsync()))
      return { ok: false, error: "This tablet can't share files — print from a computer." };
    if (!FS.cacheDirectory) return { ok: false, error: "No space for the PDF — free some storage." };
    // posterPdf is ASCII only, so writing it as UTF-8 writes exactly its bytes.
    const uri = `${FS.cacheDirectory}swapup-counter-qr-${p.code.replace(/[^A-Z0-9]/gi, "")}.pdf`;
    await FS.writeAsStringAsync(uri, posterPdf({ ...p, qr: qrMatrix(p.joinUrl) }), { encoding: FS.EncodingType.UTF8 });
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Print the counter QR" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Couldn't make the PDF${e instanceof Error && e.message ? ` (${e.message})` : ""}. Try again.` };
  }
}
