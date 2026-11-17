import { describe, expect, it } from "vitest";
import { buildPdf, charsPerLine, pdfText } from "@/lib/pdf";
import { buildEscPos, printerColumns } from "@/lib/escpos";
import { center, clampInt, DEFAULT_LAYOUT, layoutCreditNote, layoutKitchen, layoutReceipt, row, wrap, type CreditNoteData, type KitchenData, type ReceiptData } from "./layout";

const receipt: ReceiptData = {
  business: "Lakeside Cafe",
  pan: "123456789",
  branch: "Main",
  address: "Lakeside, Pokhara",
  invoiceNumber: 42,
  orderNumber: 17,
  when: "16 Nov 2026, 12:29",
  where: "T4",
  customer: "Sita Rai",
  lines: [
    { name: "Buff Momo", quantity: 2, total: 50_000, complimentary: false, note: "extra spicy", addOns: ["Cheese"] },
    { name: "Tea", quantity: 1, total: 0, complimentary: true, note: null, addOns: [] },
  ],
  subtotal: 50_000,
  discount: 5_000,
  loyaltyDiscount: 0,
  serviceCharge: 4_500,
  vat: 6_500,
  deliveryFee: 0,
  roundOff: 0,
  grandTotal: 56_000,
  payments: [{ method: "CASH", amount: 56_000 }],
  creditNotes: [{ number: 3, amount: 10_000 }],
};

describe("text helpers", () => {
  it("wraps on words and splits very long words", () => {
    expect(wrap("one two three", 7)).toEqual(["one two", "three"]);
    expect(wrap("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrap("", 10)).toEqual([""]);
  });
  it("centres and puts left and right text on one line", () => {
    expect(center("ab", 6)).toBe("  ab");
    expect(row("Total", "Rs 10", 20)).toEqual(["Total          Rs 10"]);
    expect(row("Total", "Rs 10", 20)[0]).toHaveLength(20);
  });
  it("wraps a long left side without losing the right", () => {
    const r = row("A very long dish name indeed", "Rs 250", 20);
    expect(r.length).toBeGreaterThan(1);
    expect(r[r.length - 1]!.endsWith("Rs 250")).toBe(true);
    expect(r.every((l) => l.length <= 20)).toBe(true);
  });
  it("keeps numbers inside their limits", () => {
    expect(clampInt("80", [40, 300], 80)).toBe(80);
    expect(clampInt(5, [40, 300], 80)).toBe(40);
    expect(clampInt(9999, [40, 300], 80)).toBe(300);
    expect(clampInt("abc", [40, 300], 80)).toBe(80);
    expect(clampInt(undefined, [40, 300], 80)).toBe(80);
  });
});

describe("layoutReceipt", () => {
  const lines = layoutReceipt(receipt, DEFAULT_LAYOUT, 36);
  const text = lines.map((l) => l.text).join("\n");
  it("shows the business, the bill, every line and the totals", () => {
    expect(text).toContain("Invoice #42");
    expect(text).toContain("2 x Buff Momo");
    expect(text).toContain("+ Cheese");
    expect(text).toContain("(extra spicy)");
    expect(text).toMatch(/Tea\s+free/);
    expect(text).toMatch(/TOTAL\s+Rs 560/);
    expect(text).toMatch(/Paid by cash\s+Rs 560/);
    expect(text).toMatch(/credit note #3\)\s+-Rs 100/);
    expect(text).toContain("PAN: 123456789");
    expect(text).toContain("Thank you!");
  });
  it("never runs past the paper (the doubled business name uses half the width)", () => {
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(l.size === 2 ? 18 : 36);
  });
  it("follows the settings", () => {
    const t = layoutReceipt(receipt, { ...DEFAULT_LAYOUT, showPan: false, showAddress: false, showCustomer: false, footerLine: "", headerLine: "Open 7 to 7" }, 36)
      .map((l) => l.text)
      .join("\n");
    expect(t).not.toContain("PAN");
    expect(t).not.toContain("Pokhara");
    expect(t).not.toContain("Sita");
    expect(t).not.toContain("Thank you");
    expect(t).toContain("Open 7 to 7");
  });
  it("fits a narrow 58 mm style paper too", () => {
    for (const l of layoutReceipt(receipt, DEFAULT_LAYOUT, 24)) expect(l.text.length).toBeLessThanOrEqual(l.size === 2 ? 12 : 24);
  });
});

describe("credit note and kitchen slip", () => {
  const note: CreditNoteData = { business: "Lakeside Cafe", pan: null, branch: "Main", number: 3, invoiceNumber: 42, when: "now", partial: true, subtotal: 8_000, discount: 0, loyaltyDiscount: 0, serviceCharge: 800, vat: 1_100, roundOff: 100, grandTotal: 10_000, refunds: [{ method: "CASH", amount: 10_000 }], reason: "cold food" };
  const kitchen: KitchenData = { branch: "Main", title: "T4", number: 17, time: "12:29", note: "no nuts", groups: [{ station: "Grill", items: [{ quantity: 2, name: "Buff Momo", note: "spicy", addOns: ["Cheese"] }] }, { station: "Bar", items: [{ quantity: 1, name: "Tea", note: null, addOns: [] }] }] };
  it("prints a credit note with its reason and a signature line", () => {
    const t = layoutCreditNote(note, DEFAULT_LAYOUT, 36).map((l) => l.text).join("\n");
    expect(t).toContain("CREDIT NOTE #3");
    expect(t).toMatch(/REFUNDED\s+Rs 100/);
    expect(t).toContain("Reason: cold food");
    expect(t).toContain("Customer signature");
  });
  it("prints a kitchen slip by station with large item text", () => {
    const lines = layoutKitchen(kitchen, DEFAULT_LAYOUT, 36);
    const t = lines.map((l) => l.text).join("\n");
    expect(t).toContain("T4 #17");
    expect(t).toContain("NOTE: no nuts");
    expect(t).toContain("GRILL");
    expect(t).toContain("2 x Buff Momo");
    expect(t).toContain("** spicy **");
    expect(lines.find((l) => l.text.includes("2 x Buff Momo"))).toMatchObject({ size: 2, bold: true });
    expect(layoutKitchen(kitchen, { ...DEFAULT_LAYOUT, kitchenLargeText: false }, 36).find((l) => l.text.includes("2 x Buff Momo"))?.size).toBe(1);
    expect(layoutKitchen({ ...kitchen, groups: [] }, DEFAULT_LAYOUT, 36).map((l) => l.text).join("\n")).toContain("Nothing to cook");
  });
});

describe("PDF", () => {
  const page = { widthMm: 80, marginMm: 4, fontPt: 9 };
  const lines = layoutReceipt(receipt, DEFAULT_LAYOUT, charsPerLine(page));
  const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");

  it("is a valid-looking PDF of exactly the requested width, with the text in it", () => {
    const pdf = text(buildPdf(lines, page));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("/MediaBox [0 0 226.77");
    expect(pdf).toContain("Buff Momo");
    expect(pdf).toContain("/BaseFont /Courier-Bold");
  });
  it("has an xref table whose byte positions point at the objects", () => {
    const pdf = text(buildPdf(lines, page));
    const start = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(start, start + 4)).toBe("xref");
    const offsets = [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
  it("makes the page as tall as the content when no height is set, and uses a fixed one when it is", () => {
    const auto = text(buildPdf(lines, page));
    const fixed = text(buildPdf(lines, { ...page, heightMm: 120 }));
    expect(auto).toMatch(/\/MediaBox \[0 0 226\.77 (\d+\.?\d*)\]/);
    expect(fixed).toContain("/MediaBox [0 0 226.77 340.16]");
  });
  it("adds pages when a fixed page is too short", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ text: `line ${i}` }));
    const pdf = text(buildPdf(many, { ...page, heightMm: 100 }));
    expect(Number(/\/Count (\d+)/.exec(pdf)![1])).toBeGreaterThan(1);
  });
  it("turns characters the fonts cannot draw into ? and escapes brackets", () => {
    expect(pdfText("सादा (1) a\\b")).toBe("???? \\(1\\) a\\\\b");
    expect(pdfText("2 × tea")).toBe("2 × tea");
  });
  it("fits more characters on wider paper and smaller text", () => {
    expect(charsPerLine({ widthMm: 80, marginMm: 4, fontPt: 9 })).toBeGreaterThan(charsPerLine({ widthMm: 58, marginMm: 4, fontPt: 9 }));
    expect(charsPerLine({ widthMm: 80, marginMm: 4, fontPt: 7 })).toBeGreaterThan(charsPerLine({ widthMm: 80, marginMm: 4, fontPt: 9 }));
  });
});

describe("ESC/POS", () => {
  it("starts with initialise, ends with a feed and a cut, and carries the text", () => {
    const bytes = buildEscPos([{ text: "Hello" }, { text: "TOTAL", bold: true, size: 2 }]);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Buffer.from(bytes).toString("latin1")).toContain("Hello");
    expect(Array.from(bytes.slice(-4))).toEqual([0x1d, 0x56, 0x42, 0x00]);
    // bold on, double size, then both turned back off
    const arr = Array.from(bytes);
    expect(arr.join(",")).toContain("27,69,1");
    expect(arr.join(",")).toContain("29,33,17");
    expect(arr.join(",")).toContain("29,33,0");
  });
  it("can skip the cut and replaces text the printer cannot print", () => {
    const bytes = buildEscPos([{ text: "चिया 2 × x" }], { cut: false });
    expect(Buffer.from(bytes).toString("latin1")).toContain("???? 2 x x");
    expect(Array.from(bytes.slice(-4))).not.toEqual([0x1d, 0x56, 0x42, 0x00]);
  });
  it("gives sensible columns for the usual rolls", () => {
    expect(printerColumns(58)).toBe(32);
    expect(printerColumns(80)).toBe(48);
    expect(printerColumns(100)).toBeGreaterThan(48);
  });
});
