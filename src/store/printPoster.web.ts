// Browser twin of ./printPoster.ts: the counter QR page (./counterPoster.ts) opens
// in its own tab and the browser's print dialog comes up on it — this tab keeps
// Settings exactly where it was. The tab is opened FIRST, straight from the tap,
// so popup blockers allow it; the page is written into it afterwards.
import { posterHtml } from "./counterPoster";
import { qrMatrix } from "./qrMatrix";

export type PrintResult = { ok: true } | { ok: false; error: string };

export const PRINT_LABEL = "Print";
export const PRINT_HINT = "Opens a print page in a new tab.";

const PRINT_TAB = "swapup-counter-qr";

export async function printCounterQr(p: { storeName: string; code: string; joinUrl: string }): Promise<PrintResult> {
  let w: Window | null = null;
  try {
    w = window.open("", PRINT_TAB);
  } catch {
    w = null;
  }
  if (!w) return { ok: false, error: "Pop-ups blocked — allow them, then tap Print." };
  try {
    w.document.open();
    w.document.write(posterHtml({ ...p, qr: qrMatrix(p.joinUrl) }));
    w.document.close();
    w.focus();
    const tab = w;
    // Give the new page a moment to lay out, or some browsers print it blank.
    setTimeout(() => {
      try {
        tab.print();
      } catch {
        /* the page is open — the customer-facing sheet can still be printed from the browser menu */
      }
    }, 300);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Couldn't make the print page${e instanceof Error && e.message ? ` (${e.message})` : ""}. Try again.` };
  }
}
