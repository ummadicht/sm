// The printable counter QR (Settings → Counter QR → Print): one A4 sheet that lets
// a customer start a trade-in on their own (docs/PHONE-LED-FLOW.md, "Both can start
// a trade-in"). Built here as plain text, two ways:
//   - a one-page PDF for the tablet: Android's share sheet hands a PDF to a printer
//     app, Drive or the shop PC, and every PDF viewer can print it. No print module
//     ships in the APK, and a PDF needs none — the page uses the PDF standard fonts
//     (Helvetica), so nothing is embedded and the file stays a few KB;
//   - an HTML page for the browser app, printed with the browser's own dialog.
// The QR is drawn from the module matrix the `qrcode` package makes (./qrMatrix.ts),
// the same one the on-screen QR (./QR.tsx) renders, so paper and screen agree.
//
// No runtime imports — node --test runs it (./counterPoster.test.ts).

/** The QR's dark modules, row by row from the top. */
export type QrMatrix = { size: number; dark: (row: number, col: number) => boolean };

export type Poster = { storeName: string; code: string; joinUrl: string; qr: QrMatrix };

export const POSTER_TITLE = "Check your phone for a trade-in";
export const POSTER_STEPS = [
  "Point your phone's camera at this code and tap the link.",
  "Install SwapUp Check, or test in the browser (the way to test an iPhone).",
  "Follow the steps on your phone. An advisor scans it, then confirms your price.",
];
/** Modules of white around the code: the QR standard asks for 4. */
const QUIET = 4;

// ── PDF ──────────────────────────────────────────────────────────────────────

// Glyph widths (1/1000 em) of the standard Helvetica fonts for ASCII 32–126,
// WinAnsi encoding — only used to centre and wrap lines.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELV_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/**
 * Text the standard fonts can draw: printable ASCII only. Accents are dropped
 * ("Café" → "Cafe"), typographic punctuation becomes its plain twin, and anything
 * else is left out rather than printed as a wrong glyph.
 */
export function pdfSafe(s: string): string {
  let t = s;
  try {
    t = t.normalize("NFD");
  } catch {
    /* an engine without normalize: accented letters are simply left out below */
  }
  return t
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[·•]/g, "-")
    .replace(/…/g, "...")
    .replace(/₹/g, "Rs ")
    .replace(/[    ]/g, " ")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function textWidth(s: string, size: number, bold: boolean, spacing = 0): number {
  const w = bold ? HELV_BOLD : HELV;
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += w[s.charCodeAt(i) - 32] ?? 556;
  return (sum * size) / 1000 + spacing * Math.max(0, s.length - 1);
}

/** Largest size ≤ max (and ≥ min) at which the line fits the width. */
function fit(s: string, max: number, min: number, width: number, bold: boolean, spacing = 0): number {
  let size = max;
  while (size > min && textWidth(s, size, bold, spacing) > width) size -= 1;
  return size;
}

function wrap(s: string, size: number, width: number, bold: boolean): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, bold) > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

const n = (x: number) => (Math.round(x * 100) / 100).toString();
const pdfString = (s: string) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;

/** One A4 page: title, store, the QR, the code, the link, three steps. ASCII only, so its length is its size in bytes. */
export function posterPdf(p: Poster): string {
  const W = 595;
  const H = 842;
  const M = 56;
  const inner = W - 2 * M;
  const ops: string[] = [];
  const text = (s: string, x: number, y: number, size: number, bold: boolean, gray = 0, spacing = 0) =>
    ops.push(`BT ${n(gray)} g /${bold ? "F2" : "F1"} ${n(size)} Tf ${n(spacing)} Tc ${n(x)} ${n(y)} Td ${pdfString(s)} Tj ET`);
  const centred = (s: string, y: number, size: number, bold: boolean, gray = 0, spacing = 0) =>
    text(s, (W - textWidth(s, size, bold, spacing)) / 2, y, size, bold, gray, spacing);

  let y = H - 92;
  const title = pdfSafe(POSTER_TITLE);
  centred(title, y, fit(title, 30, 16, inner, true), true);
  const store = pdfSafe(p.storeName);
  if (store) {
    y -= 34;
    centred(store, y, fit(store, 20, 11, inner, false), false, 0.3);
  }

  // The QR, quiet zone included, in a 330 pt square — about 11.6 cm, easy to scan from arm's length.
  const box = 330;
  const units = p.qr.size + 2 * QUIET;
  const mod = box / units;
  const top = y - 26;
  const x0 = (W - box) / 2;
  const y0 = top - box;
  const rects: string[] = [];
  for (let r = 0; r < p.qr.size; r++) {
    const row = units - QUIET - 1 - r; // PDF y grows upwards
    let c = 0;
    while (c < p.qr.size) {
      if (!p.qr.dark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < p.qr.size && p.qr.dark(r, c)) c++;
      rects.push(`${start + QUIET} ${row} ${c - start} 1 re`);
    }
  }
  ops.push(`q 0 g ${n(mod)} 0 0 ${n(mod)} ${n(x0)} ${n(y0)} cm ${rects.join(" ")} f Q`);

  y = y0 - 52;
  const code = pdfSafe(p.code);
  centred(code, y, fit(code, 46, 20, inner, true, 8), true, 0, 8);
  y -= 26;
  const link = pdfSafe(`Can't scan? Go to ${p.joinUrl}`);
  centred(link, y, fit(link, 12, 7, inner, false), false, 0.3);

  y -= 46;
  const stepSize = 15;
  const indent = 30;
  POSTER_STEPS.forEach((step, i) => {
    text(`${i + 1}`, M + 8, y, stepSize, true);
    for (const line of wrap(pdfSafe(step), stepSize, inner - indent, false)) {
      text(line, M + indent, y, stepSize, false);
      y -= stepSize * 1.4;
    }
    y -= 6;
  });
  centred("SwapUp", 40, 10, true, 0.55);

  const content = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title ${pdfString(pdfSafe(`Counter QR - ${p.storeName}`))} /Producer (SwapUp Store) >>`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  // Each cross-reference entry is exactly 20 bytes: 10-digit offset, space, 5-digit generation, space, n|f, space, newline.
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

// ── HTML (the browser app) ───────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The QR as one SVG path, quiet zone included. crispEdges keeps printers from blurring the module edges. */
export function qrSvg(qr: QrMatrix): string {
  const units = qr.size + 2 * QUIET;
  let d = "";
  for (let r = 0; r < qr.size; r++) {
    let c = 0;
    while (c < qr.size) {
      if (!qr.dark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < qr.size && qr.dark(r, c)) c++;
      d += `M${start + QUIET} ${r + QUIET}h${c - start}v1h-${c - start}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${units} ${units}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${units}" height="${units}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export function posterHtml(p: Poster): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`Counter QR · ${p.storeName}`)}</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; background: #fff; text-align: center; }
h1 { font-size: 30px; margin: 0 0 6px; }
.store { font-size: 20px; color: #444; margin: 0; }
.qr { width: 11.6cm; max-width: 90vw; margin: 22px auto 10px; }
.qr svg { display: block; width: 100%; height: auto; }
.code { font-size: 48px; font-weight: 800; letter-spacing: 10px; margin: 6px 0 4px; font-variant-numeric: tabular-nums; }
.url { font-size: 14px; color: #444; word-break: break-all; margin: 0 0 22px; }
ol { display: inline-block; text-align: left; font-size: 18px; line-height: 1.5; max-width: 16cm; margin: 0; padding-left: 1.4em; }
li { margin-bottom: 6px; }
.brand { margin-top: 28px; font-size: 12px; font-weight: 700; color: #777; }
</style></head>
<body>
<h1>${esc(POSTER_TITLE)}</h1>
${p.storeName.trim() ? `<p class="store">${esc(p.storeName.trim())}</p>` : ""}
<div class="qr">${qrSvg(p.qr)}</div>
<div class="code">${esc(p.code)}</div>
<p class="url">Can't scan? Go to ${esc(p.joinUrl)}</p>
<ol>${POSTER_STEPS.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<div class="brand">SwapUp</div>
</body></html>`;
}
