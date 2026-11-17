import { describe, expect, it } from "vitest";
import { DEFAULT_BILL_CONFIG, calculateBill, formatNpr, type BillConfig } from "./calc";

const cfg = (over: Partial<BillConfig> = {}): BillConfig => ({
  ...DEFAULT_BILL_CONFIG,
  ...over,
});

describe("calculateBill", () => {
  it("adds service charge then VAT on top (exclusive)", () => {
    // Rs 1000 -> +10% service = 1100 -> +13% VAT on 1100 = 143 -> 1243 -> rounds to 1243
    const t = calculateBill([{ unitPrice: 50_000, quantity: 2 }], cfg());
    expect(t.subtotal).toBe(100_000);
    expect(t.serviceCharge).toBe(10_000);
    expect(t.vat).toBe(14_300);
    expect(t.grandTotal).toBe(124_300);
    expect(t.roundOff).toBe(0);
  });

  it("applies percent discount before service charge and VAT", () => {
    const t = calculateBill(
      [{ unitPrice: 100_000, quantity: 1 }],
      cfg({ discount: { kind: "percent", bps: 1000 } }),
    );
    expect(t.discount).toBe(10_000);
    expect(t.serviceCharge).toBe(9_000);
    expect(t.vat).toBe(12_870);
    expect(t.totalBeforeRounding).toBe(111_870);
    expect(t.grandTotal).toBe(111_900); // default config rounds to the rupee
    expect(t.roundOff).toBe(30);
  });

  it("caps an amount discount at the subtotal", () => {
    const t = calculateBill(
      [{ unitPrice: 10_000, quantity: 1 }],
      cfg({ discount: { kind: "amount", amount: 99_999 } }),
    );
    expect(t.discount).toBe(10_000);
    expect(t.grandTotal).toBe(0);
  });

  it("charges nothing for complimentary lines", () => {
    const t = calculateBill(
      [
        { unitPrice: 20_000, quantity: 1 },
        { unitPrice: 50_000, quantity: 3, complimentary: true },
      ],
      cfg({ serviceChargeBps: 0, vatMode: "NONE", roundToRupee: false }),
    );
    expect(t.subtotal).toBe(20_000);
    expect(t.grandTotal).toBe(20_000);
  });

  it("extracts VAT without adding it when inclusive", () => {
    // Price already holds 13% VAT: 11300 / 1.13 -> VAT 1300
    const t = calculateBill(
      [{ unitPrice: 1_130_000, quantity: 1 }],
      cfg({ serviceChargeBps: 0, vatMode: "INCLUSIVE", roundToRupee: false }),
    );
    expect(t.vat).toBe(130_000);
    expect(t.grandTotal).toBe(1_130_000);
  });

  it("rounds the grand total to the nearest rupee and records the round-off", () => {
    // 3 x Rs 33.33 = 99.99 -> no charges -> rounds to 100.00
    const t = calculateBill(
      [{ unitPrice: 3_333, quantity: 3 }],
      cfg({ serviceChargeBps: 0, vatMode: "NONE" }),
    );
    expect(t.totalBeforeRounding).toBe(9_999);
    expect(t.grandTotal).toBe(10_000);
    expect(t.roundOff).toBe(1);
  });

  it("can exclude service charge from the VAT base", () => {
    const t = calculateBill(
      [{ unitPrice: 100_000, quantity: 1 }],
      cfg({ vatAppliesToServiceCharge: false, roundToRupee: false }),
    );
    expect(t.vat).toBe(13_000);
    expect(t.grandTotal).toBe(123_000);
  });

  it("rejects fractional paisa, negatives and bad discounts", () => {
    expect(() => calculateBill([{ unitPrice: 10.5, quantity: 1 }], cfg())).toThrow(RangeError);
    expect(() => calculateBill([{ unitPrice: -1, quantity: 1 }], cfg())).toThrow(RangeError);
    expect(() =>
      calculateBill([{ unitPrice: 100, quantity: 1 }], cfg({ discount: { kind: "percent", bps: 10_001 } })),
    ).toThrow(RangeError);
  });

  it("applies a reward discount after the normal discount and before charges", () => {
    // Rs 1000 - 10% (100) - reward 50 = 850 -> +10% service 85 = 935 -> +13% VAT 121.55 = 1056.55 -> 1057
    const t = calculateBill(
      [{ unitPrice: 100_000, quantity: 1 }],
      cfg({ discount: { kind: "percent", bps: 1000 }, loyaltyDiscount: 5_000 }),
    );
    expect(t.discount).toBe(10_000);
    expect(t.loyaltyDiscount).toBe(5_000);
    expect(t.serviceCharge).toBe(8_500);
    expect(t.vat).toBe(12_155);
    expect(t.grandTotal).toBe(105_700);
  });

  it("refuses a reward bigger than what is left to pay, or a negative one", () => {
    const lines = [{ unitPrice: 10_000, quantity: 1 }];
    expect(() => calculateBill(lines, cfg({ loyaltyDiscount: 10_001 }))).toThrow("larger than the bill");
    expect(() => calculateBill(lines, cfg({ discount: { kind: "percent", bps: 5000 }, loyaltyDiscount: 5_001 }))).toThrow("larger than the bill");
    expect(() => calculateBill(lines, cfg({ loyaltyDiscount: -1 }))).toThrow(RangeError);
    expect(calculateBill(lines, cfg({ loyaltyDiscount: 10_000 })).grandTotal).toBe(0); // a full reward is allowed
  });

  it("reports zero reward when none is given", () => {
    expect(calculateBill([{ unitPrice: 10_000, quantity: 1 }], cfg()).loyaltyDiscount).toBe(0);
  });

  it("returns zeros for an empty order", () => {
    const t = calculateBill([], cfg());
    expect(t.grandTotal).toBe(0);
  });
});

describe("formatNpr", () => {
  it("groups thousands and hides zero paisa", () => {
    expect(formatNpr(124_300)).toBe("Rs 1,243");
    expect(formatNpr(123_456_789)).toBe("Rs 1,234,567.89");
    expect(formatNpr(5)).toBe("Rs 0.05");
  });
});

describe("delivery fee", () => {
  const cfg = { ...DEFAULT_BILL_CONFIG, roundToRupee: false };
  it("is added after tax and is not itself charged service or VAT", () => {
    const without = calculateBill([{ unitPrice: 20_000, quantity: 1 }], cfg);
    const withFee = calculateBill([{ unitPrice: 20_000, quantity: 1 }], { ...cfg, deliveryFee: 15_000 });
    expect(withFee.deliveryFee).toBe(15_000);
    expect(withFee.serviceCharge).toBe(without.serviceCharge);
    expect(withFee.vat).toBe(without.vat);
    expect(withFee.grandTotal).toBe(without.grandTotal + 15_000);
  });
  it("is not reduced by a discount, and adds up in every VAT mode", () => {
    const d = calculateBill([{ unitPrice: 10_000, quantity: 1 }], { ...cfg, discount: { kind: "percent", bps: 10_000 }, deliveryFee: 5_000 });
    expect(d.discount).toBe(10_000);
    expect(d.grandTotal).toBe(5_000);
    for (const vatMode of ["NONE", "INCLUSIVE", "EXCLUSIVE"] as const) {
      const t = calculateBill([{ unitPrice: 10_000, quantity: 1 }], { ...cfg, vatMode, deliveryFee: 5_000 });
      expect(t.totalBeforeRounding).toBe(calculateBill([{ unitPrice: 10_000, quantity: 1 }], { ...cfg, vatMode }).totalBeforeRounding + 5_000);
    }
  });
  it("rejects a negative or fractional fee, and defaults to none", () => {
    expect(() => calculateBill([], { ...cfg, deliveryFee: -1 })).toThrow(RangeError);
    expect(() => calculateBill([], { ...cfg, deliveryFee: 1.5 })).toThrow(RangeError);
    expect(calculateBill([{ unitPrice: 100, quantity: 1 }], cfg).deliveryFee).toBe(0);
  });
});
