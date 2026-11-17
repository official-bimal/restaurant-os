import { describe, expect, it } from "vitest";
import { deliveryState, isComplete, orderText, priceVariance, proportionalEstimate, remaining, suggestQuantity } from "./purchasing";

describe("suggestQuantity", () => {
  it("tops up to twice the reorder level when at or below it", () => {
    expect(suggestQuantity({ quantity: 800, reorderLevel: 1000, onOrder: 0 })).toBe(1200); // target 2000
    expect(suggestQuantity({ quantity: 1000, reorderLevel: 1000, onOrder: 0 })).toBe(1000);
    expect(suggestQuantity({ quantity: 0, reorderLevel: 1000, onOrder: 0 })).toBe(2000);
  });
  it("treats negative stock as zero, not as extra to buy", () => {
    expect(suggestQuantity({ quantity: -300, reorderLevel: 1000, onOrder: 0 })).toBe(2000);
  });
  it("counts what is already on order", () => {
    expect(suggestQuantity({ quantity: 200, reorderLevel: 1000, onOrder: 1800 })).toBe(0); // 2000 on hand+order > level
    expect(suggestQuantity({ quantity: 200, reorderLevel: 1000, onOrder: 500 })).toBe(1300);
  });
  it("suggests nothing when stock is fine or no level is set", () => {
    expect(suggestQuantity({ quantity: 1001, reorderLevel: 1000, onOrder: 0 })).toBe(0);
    expect(suggestQuantity({ quantity: 0, reorderLevel: 0, onOrder: 0 })).toBe(0);
  });
});

describe("delivery progress", () => {
  const l = (o: number, r: number) => ({ quantityOrdered: o, quantityReceived: r });
  it("works out remaining, complete and state", () => {
    expect(remaining(l(100, 30))).toBe(70);
    expect(remaining(l(100, 130))).toBe(0);
    expect(isComplete([l(100, 100), l(50, 60)])).toBe(true);
    expect(isComplete([l(100, 100), l(50, 49)])).toBe(false);
    expect(isComplete([])).toBe(false);
    expect(deliveryState([l(100, 0), l(50, 0)])).toBe("NONE");
    expect(deliveryState([l(100, 100), l(50, 0)])).toBe("PART");
    expect(deliveryState([l(100, 100), l(50, 50)])).toBe("ALL");
  });
});

describe("price variance", () => {
  it("compares what was paid with the expected price of what arrived", () => {
    expect(proportionalEstimate(10_000, 1000, 250)).toBe(2_500);
    expect(proportionalEstimate(10_000, 0, 5)).toBe(0);
    expect(priceVariance({ quantityOrdered: 1000, quantityReceived: 500, estimatedTotal: 10_000, paidTotal: 5_600 })).toBe(600);
    expect(priceVariance({ quantityOrdered: 1000, quantityReceived: 1000, estimatedTotal: 10_000, paidTotal: 9_500 })).toBe(-500);
    expect(priceVariance({ quantityOrdered: 1000, quantityReceived: 0, estimatedTotal: 10_000, paidTotal: 0 })).toBe(0);
  });
});

describe("orderText", () => {
  it("writes a message a person can paste", () => {
    const t = orderText({
      business: "Demo Cafe",
      supplier: "Pokhara Mill",
      number: 7,
      expectedOn: "2026-11-20",
      note: "Deliver before 9",
      lines: [{ name: "Flour", unit: "g", quantity: 5000 }, { name: "Milk", unit: "ml", quantity: 20000 }],
    });
    expect(t).toBe(
      ["Order #7 from Demo Cafe for Pokhara Mill", "- Flour: 5,000 g", "- Milk: 20,000 ml", "Needed by 2026-11-20", "Note: Deliver before 9", "Please confirm. Thank you."].join("\n"),
    );
  });
  it("leaves out the date and note when there are none", () => {
    const t = orderText({ business: "B", supplier: "S", number: 1, expectedOn: null, note: null, lines: [{ name: "X", unit: "piece", quantity: 3 }] });
    expect(t).toBe("Order #1 from B for S\n- X: 3 piece\nPlease confirm. Thank you.");
  });
});
