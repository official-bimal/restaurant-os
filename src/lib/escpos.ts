/**
 * ESC/POS: the command language most thermal receipt and kitchen printers understand. This turns the same lines that feed
 * the PDF into the bytes a printer expects, so a connected printer prints exactly what the PDF shows.
 *
 * Written from the published command set and checked against it in tests, but NOT yet tried on a physical printer:
 * printers differ in small ways (code pages, cutter, character widths), so expect to adjust after the first real print.
 */

import type { PdfLine } from "./pdf";

const ESC = 0x1b;
const GS = 0x1d;

/** Characters per line of the printer's normal font for a paper width (58 mm = 32, 80 mm = 48, others in proportion). */
export function printerColumns(widthMm: number): number {
  if (widthMm <= 58) return Math.max(16, Math.round((widthMm / 58) * 32));
  return Math.max(16, Math.round((widthMm / 80) * 48));
}

/** Printable ASCII and Latin-1 are kept; everything else becomes "?". */
function toBytes(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c <= 0x7e) out.push(c);
    else if (c === 0xd7) out.push(0x78); // × as x
    else if (c === 0x2022) out.push(0x2a); // bullet as *
    else if (c === 0x2013 || c === 0x2014) out.push(0x2d);
    else if (c === 0x2018 || c === 0x2019) out.push(0x27);
    else if (c === 0x201c || c === 0x201d) out.push(0x22);
    else out.push(0x3f);
  }
  return out;
}

export function buildEscPos(lines: PdfLine[], opts: { cut?: boolean } = {}): Uint8Array {
  const b: number[] = [ESC, 0x40]; // initialise
  let bold = false;
  let size = 1;
  for (const l of lines) {
    const wantBold = !!l.bold;
    if (wantBold !== bold) {
      b.push(ESC, 0x45, wantBold ? 1 : 0);
      bold = wantBold;
    }
    const wantSize = Math.min(4, Math.max(1, Math.round(l.size ?? 1)));
    if (wantSize !== size) {
      const n = (wantSize - 1) * 0x11; // width and height multiplied together
      b.push(GS, 0x21, n);
      size = wantSize;
    }
    b.push(...toBytes(l.text), 0x0a);
  }
  if (bold) b.push(ESC, 0x45, 0);
  if (size !== 1) b.push(GS, 0x21, 0);
  b.push(0x0a, 0x0a, 0x0a); // feed past the cutter
  if (opts.cut !== false) b.push(GS, 0x56, 0x42, 0x00); // partial cut after feeding
  return new Uint8Array(b);
}
