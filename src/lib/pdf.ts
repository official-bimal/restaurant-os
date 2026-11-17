/**
 * A tiny PDF writer for printed slips: monospaced text on a page of any size. No library: a PDF is a few objects and a
 * table of byte positions, and slips need nothing more. Text is drawn in the built-in Courier fonts, which cover English
 * (Latin) letters; any other character (for example Devanagari) is drawn as "?" because those fonts do not contain it.
 */

export interface PdfLine {
  text: string;
  bold?: boolean;
  /** Text size as a multiple of the base size (1 = normal, 2 = double). */
  size?: number;
}

export interface PdfPage {
  widthMm: number;
  /** A fixed height, or null / undefined to make the page exactly as tall as its text. */
  heightMm?: number | null;
  marginMm: number;
  /** Base font size in points. */
  fontPt: number;
}

const MM = 72 / 25.4;
const LEADING = 1.25;
const CHAR_W = 0.6; // Courier: every character is 0.6 of the font size wide

/** How many characters of the base size fit across the page. Layouts are built to this width. */
export function charsPerLine(page: Pick<PdfPage, "widthMm" | "marginMm" | "fontPt">): number {
  return Math.max(10, Math.floor(((page.widthMm - 2 * page.marginMm) * MM) / (CHAR_W * page.fontPt)));
}

/** Replace anything the PDF fonts cannot draw, and escape what PDF strings treat specially. */
export function pdfText(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += "\\" + ch;
    else if (c >= 0x20 && c <= 0x7e) out += ch;
    else if (c >= 0xa0 && c <= 0xff) out += ch; // Latin-1 letters and symbols (× is here)
    else if (c === 0x2022) out += "\\225"; // bullet
    else if (c === 0x2013 || c === 0x2014) out += "-";
    else if (c === 0x2018 || c === 0x2019) out += "'";
    else if (c === 0x201c || c === 0x201d) out += '"';
    else out += "?";
  }
  return out;
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

export function buildPdf(lines: PdfLine[], page: PdfPage): Uint8Array {
  const wPt = page.widthMm * MM;
  const margin = page.marginMm * MM;
  const heights = lines.map((l) => page.fontPt * (l.size ?? 1) * LEADING);

  // Split the lines into pages: one tall page when the height is free, otherwise as many fixed pages as needed.
  const pages: { lines: PdfLine[]; hs: number[] }[] = [];
  let hPt: number;
  if (page.heightMm) {
    hPt = page.heightMm * MM;
    const usable = hPt - 2 * margin;
    let cur = { lines: [] as PdfLine[], hs: [] as number[] };
    let used = 0;
    lines.forEach((l, i) => {
      if (used + heights[i]! > usable && cur.lines.length > 0) {
        pages.push(cur);
        cur = { lines: [], hs: [] };
        used = 0;
      }
      cur.lines.push(l);
      cur.hs.push(heights[i]!);
      used += heights[i]!;
    });
    pages.push(cur);
  } else {
    hPt = Math.max(40, heights.reduce((a, b) => a + b, 0) + 2 * margin);
    pages.push({ lines, hs: heights });
  }

  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length; // returns the object number (1-based)
  // Every character that reaches the file is one byte in Latin-1 (pdfText guarantees it), so a string's length is its byte length.
  // Nothing here is Node-only: the same code runs in the browser, so a bill can be printed with no connection.
  const len = (t: string) => t.length;

  add("<< /Type /Catalog /Pages 2 0 R >>"); // 1
  add("PAGES"); // 2, filled in below
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"); // 3
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>"); // 4

  const pageNums: number[] = [];
  for (const pg of pages) {
    let y = hPt - margin;
    let content = "";
    pg.lines.forEach((l, i) => {
      const size = page.fontPt * (l.size ?? 1);
      y -= pg.hs[i]!;
      content += `BT /${l.bold ? "F2" : "F1"} ${fmt(size)} Tf ${fmt(margin)} ${fmt(y + size * 0.25)} Td (${pdfText(l.text)}) Tj ET\n`;
    });
    const contentNum = add(`<< /Length ${len(content)} >>\nstream\n${content}endstream`);
    pageNums.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(wPt)} ${fmt(hPt)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNum} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageNums.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(len(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = len(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}
