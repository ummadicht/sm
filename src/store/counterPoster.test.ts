// node --test --experimental-strip-types --no-warnings src/store/counterPoster.test.ts
// The printable counter QR: the PDF must be a well-formed file (offsets byte-exact),
// draw exactly the QR's dark modules, and print only text the standard fonts have.
// Same import trick as ./pin.test.ts; `qrcode` is the package the app draws with.
import test from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";

const P: typeof import("./counterPoster") = await import("./counterPoster" + ".ts");

const URL = "https://swapup.104-197-168-25.sslip.io/j/K7M2QX";
function matrix(value: string) {
  const m = QRCode.create(value, { errorCorrectionLevel: "M" }).modules;
  return { size: m.size, dark: (r: number, c: number) => !!m.get(r, c) };
}
const poster = (storeName = "Samsung Service Centre — Andheri (W)") => ({ storeName, code: "K7M2QX", joinUrl: URL, qr: matrix(URL) });

function darkCount(qr: { size: number; dark: (r: number, c: number) => boolean }) {
  let k = 0;
  for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) if (qr.dark(r, c)) k++;
  return k;
}

test("posterPdf: a well-formed one-page PDF, ASCII only", () => {
  const pdf = P.posterPdf(poster());
  assert.ok(pdf.startsWith("%PDF-1.4\n"));
  assert.ok(pdf.endsWith("%%EOF\n"));
  assert.match(pdf, /^[\x0a\x20-\x7e]*$/, "ASCII only — its length is its size in bytes");

  // Every cross-reference offset lands on its object.
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)![1]);
  assert.ok(pdf.startsWith("xref\n", startxref), "startxref points at the table");
  const table = pdf.slice(startxref).split("\n");
  const count = Number(table[1].split(" ")[1]);
  assert.equal(count, 8, "7 objects + the free entry");
  assert.equal(table[2], "0000000000 65535 f ");
  for (let i = 1; i < count; i++) {
    const entry = table[2 + i];
    assert.equal(entry.length + 1, 20, "each entry is 20 bytes with its newline");
    assert.ok(pdf.startsWith(`${i} 0 obj\n`, Number(entry.slice(0, 10))), `object ${i}`);
  }
  assert.match(pdf, /trailer\n<< \/Size 8 \/Root 1 0 R \/Info 7 0 R >>/);

  // The stream's /Length is exact.
  const m = /<< \/Length (\d+) >>\nstream\n/.exec(pdf)!;
  const start = m.index + m[0].length;
  assert.ok(pdf.startsWith("\nendstream", start + Number(m[1])));
});

test("posterPdf: draws exactly the QR's dark modules, and the words", () => {
  const p = poster();
  const pdf = P.posterPdf(p);
  const area = [...pdf.matchAll(/(\d+) (\d+) (\d+) 1 re/g)].reduce((sum, r) => sum + Number(r[3]), 0);
  assert.equal(area, darkCount(p.qr));
  assert.match(pdf, /\(Check your phone for a trade-in\) Tj/);
  assert.match(pdf, /\(Samsung Service Centre - Andheri \\\(W\\\)\) Tj/, "dash made plain, brackets escaped");
  assert.match(pdf, /\(K7M2QX\) Tj/);
  assert.match(pdf, /\(Can't scan\? Go to https:\/\/swapup\.104-197-168-25\.sslip\.io\/j\/K7M2QX\) Tj/);
  // A long step wraps instead of running off the page.
  assert.ok(P.POSTER_STEPS.every((s) => pdf.includes(s.split(" ")[0])));
  // No store name: no empty line for it.
  assert.doesNotMatch(P.posterPdf(poster("")), /\(\) Tj/);
});

test("pdfSafe: only what Helvetica can draw", () => {
  assert.equal(P.pdfSafe("Café “Nova” – Andheri · ₹ store…"), 'Cafe "Nova" - Andheri - Rs store...');
  assert.equal(P.pdfSafe("मोबाइल Hub"), "Hub", "a script the standard fonts lack is left out, not printed as wrong glyphs");
  assert.equal(P.pdfSafe("  two   spaces  "), "two spaces");
});

test("qrSvg / posterHtml: the browser page", () => {
  const p = poster("Rao & Sons <Mobile>");
  const svg = P.qrSvg(p.qr);
  const area = [...svg.matchAll(/h(\d+)v1/g)].reduce((sum, r) => sum + Number(r[1]), 0);
  assert.equal(area, darkCount(p.qr));
  assert.match(svg, new RegExp(`viewBox="0 0 ${p.qr.size + 8} ${p.qr.size + 8}"`), "4-module quiet zone each side");
  const html = P.posterHtml(p);
  assert.match(html, /<p class="store">Rao &amp; Sons &lt;Mobile&gt;<\/p>/);
  assert.match(html, /<div class="code">K7M2QX<\/div>/);
  assert.ok(html.includes(URL));
  assert.doesNotMatch(P.posterHtml(poster("  ")), /class="store"/);
});
