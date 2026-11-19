import { describe, expect, it } from "vitest";
import { billDates, cleanBuyer, copyNote, invoiceLabel, isValidPan, taxSplit } from "./ird";

describe("IRD bill helpers", () => {
  it("labels a bill with its fiscal year", () => {
    expect(invoiceLabel("2083/84", 12)).toBe("2083/84-12");
  });
  it("finds the fiscal year and both dates in Kathmandu time", () => {
    // 17 July 2026 00:30 in Kathmandu is still 16 July in UTC: the Nepali date and fiscal year follow Kathmandu.
    const d = billDates(new Date("2026-07-16T19:00:00Z"), "Asia/Kathmandu");
    expect(d).toEqual({ date: "2026-07-17", bs: "2083-04-01", fiscalYear: "2083/84" });
    expect(billDates(new Date("2026-07-16T17:00:00Z"), "Asia/Kathmandu").fiscalYear).toBe("2082/83");
  });
  it("checks a PAN", () => {
    expect(isValidPan("123456789")).toBe(true);
    expect(isValidPan("12345678")).toBe(false);
    expect(isValidPan("12345678a")).toBe(false);
  });
  it("cleans buyer details", () => {
    expect(cleanBuyer("", "")).toEqual({ name: null, pan: null });
    expect(cleanBuyer("  Hotel  Everest ", "123456789")).toEqual({ name: "Hotel Everest", pan: "123456789" });
    expect(cleanBuyer("", "123456789")).toEqual({ error: "Enter the buyer name beside the PAN." });
    expect(cleanBuyer("X", "12")).toEqual({ error: "A PAN has nine digits." });
  });
  it("marks only reprints", () => {
    expect(copyNote(0)).toBeNull();
    expect(copyNote(2)).toBe("COPY OF ORIGINAL (reprint 2)");
  });
  it("splits taxable and non-taxable parts", () => {
    const rules = { vatAppliesToServiceCharge: true, vatOnDeliveryFee: false };
    expect(taxSplit({ grandTotal: 11_300, serviceCharge: 1_000, vat: 1_300, deliveryFee: 0 }, rules)).toEqual({ taxable: 10_000, nonTaxable: 0, vat: 1_300 });
    expect(taxSplit({ grandTotal: 12_300, serviceCharge: 1_000, vat: 1_300, deliveryFee: 1_000 }, rules)).toEqual({ taxable: 10_000, nonTaxable: 1_000, vat: 1_300 });
    expect(taxSplit({ grandTotal: 5_000, serviceCharge: 0, vat: 0, deliveryFee: 0 }, rules)).toEqual({ taxable: 0, nonTaxable: 5_000, vat: 0 });
  });
});
