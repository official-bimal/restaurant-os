import { describe, expect, it } from "vitest";
import { buildXlsx, colName, crc32, rupees, sheetName, xmlText, zipStored } from "./xlsx";

/** Reads a stored zip back, checking every checksum, so the test proves the file is well formed. */
function unzip(zip: Uint8Array): Record<string, string> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.slice(p + 46, p + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = zip.slice(dataAt, dataAt + size);
    expect(crc32(data)).toBe(crc);
    out[name] = new TextDecoder().decode(data);
    p += 46 + nameLen;
  }
  eocd = 0;
  return out;
}

describe("crc32 and zip", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("round-trips files with intact checksums", () => {
    const enc = new TextEncoder();
    const files = unzip(zipStored([{ name: "a.txt", data: enc.encode("hello") }, { name: "dir/b.txt", data: enc.encode("नमस्ते") }]));
    expect(files).toEqual({ "a.txt": "hello", "dir/b.txt": "नमस्ते" });
  });
});

describe("helpers", () => {
  it("names columns like a spreadsheet", () => {
    expect([colName(0), colName(25), colName(26), colName(27), colName(701), colName(702)]).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
  it("escapes XML and drops forbidden control characters", () => {
    expect(xmlText('a & b < c > "d"\u0001\u0008')).toBe("a &amp; b &lt; c &gt; &quot;d&quot;");
  });
  it("makes safe, unique sheet names of at most 31 characters", () => {
    const used = new Set<string>();
    expect(sheetName("Sales: 2026/11 [x]", used)).toBe("Sales  2026 11  x");
    expect(sheetName("Sales: 2026/11 [x]", used)).toBe("Sales  2026 11  x 2");
    expect(sheetName("x".repeat(60), used)).toHaveLength(31);
    expect(sheetName("", used)).toBe("Sheet");
  });
  it("turns paisa into a rupee amount without drift", () => {
    expect(rupees(12_345)).toEqual({ money: 123.45 });
    expect(rupees(-5)).toEqual({ money: -0.05 });
  });
});

describe("buildXlsx", () => {
  const book = unzip(
    buildXlsx([
      { name: "Sales", widths: [12, 30], rows: [["Number", "Customer", "Total"], [1, "Sita & Co", rupees(56_000)], [2, null, { money: 1.5 }], [3, "x", true]] },
      { name: "Empty", rows: [] },
    ]),
  );
  it("contains the parts a spreadsheet program needs", () => {
    for (const f of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) expect(book[f], f).toBeTruthy();
  });
  it("lists the sheets by name", () => {
    expect(book["xl/workbook.xml"]).toContain('<sheet name="Sales" sheetId="1" r:id="rId1"/>');
    expect(book["xl/workbook.xml"]).toContain('<sheet name="Empty" sheetId="2" r:id="rId2"/>');
  });
  it("writes text, numbers, money and booleans in the right cells, with the header bold", () => {
    const s = book["xl/worksheets/sheet1.xml"]!;
    expect(s).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Number</t></is></c>');
    expect(s).toContain('<c r="A2"><v>1</v></c>');
    expect(s).toContain("Sita &amp; Co");
    expect(s).toContain('<c r="C2" s="2"><v>560</v></c>');
    expect(s).toContain('<c r="C3" s="2"><v>1.5</v></c>');
    expect(s).toContain('<c r="C4" t="b"><v>1</v></c>');
    expect(s).not.toContain('r="B3"'); // an empty cell is simply left out
    expect(s).toContain('<col min="2" max="2" width="30" customWidth="1"/>');
  });
  it("is well-formed XML throughout (every tag closes)", () => {
    for (const [name, xml] of Object.entries(book)) {
      if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
      const stack: string[] = [];
      for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
        if (m[3]) continue;
        if (m[1]) expect(stack.pop(), name).toBe(m[2]);
        else stack.push(m[2]!);
      }
      expect(stack, name).toEqual([]);
    }
  });
});
