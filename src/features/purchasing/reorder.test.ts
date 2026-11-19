import { describe, expect, it } from "vitest";
import { byUrgency, dailyUse, dataDays, planItem, showQty } from "./reorder";

const base = { onHand: 0, onOrder: 0, dailyUse: 0, leadDays: 2, coverDays: 7, packQuantity: 1, reorderLevel: 0 };

describe("how fast stock is used", () => {
  it("divides use by days, and is zero with no use", () => {
    expect(dailyUse(2800, 28)).toBe(100);
    expect(dailyUse(0, 28)).toBe(0);
    expect(dailyUse(100, 0)).toBe(0);
  });
  it("uses the days there really are, never more than the window", () => {
    const now = new Date("2026-11-19T00:00:00Z");
    expect(dataDays(new Date("2026-11-12T00:00:00Z"), now, 28)).toBe(7);
    expect(dataDays(new Date("2026-01-01T00:00:00Z"), now, 28)).toBe(28);
    expect(dataDays(new Date("2026-11-19T00:00:00Z"), now, 28)).toBe(1);
    expect(dataDays(null, now, 28)).toBe(28);
  });
});

describe("what to order", () => {
  it("covers the lead time plus the days of cover, less stock and what is on its way", () => {
    // 100 g a day for 9 days = 900 g wanted; 300 on hand and 200 on order leaves 400.
    expect(planItem({ ...base, dailyUse: 100, onHand: 300, onOrder: 200 }).quantity).toBe(400);
    expect(planItem({ ...base, dailyUse: 100, onHand: 900 }).quantity).toBe(0);
    expect(planItem({ ...base, dailyUse: 100, onHand: -50 }).quantity).toBe(900); // stock below zero counts as nothing
  });
  it("rounds up to whole packs", () => {
    expect(planItem({ ...base, dailyUse: 100, packQuantity: 1000 }).quantity).toBe(1000);
    expect(planItem({ ...base, dailyUse: 250, packQuantity: 1000 }).quantity).toBe(3000); // 2,250 wanted
  });
  it("never orders less than the reorder level, and still works with no use", () => {
    expect(planItem({ ...base, dailyUse: 10, reorderLevel: 500 }).quantity).toBe(500);
    expect(planItem({ ...base, reorderLevel: 500, onHand: 100 }).quantity).toBe(400);
    expect(planItem(base).quantity).toBe(0);
  });
});

describe("urgency", () => {
  it("is now when stock will not last until a delivery could arrive", () => {
    expect(planItem({ ...base, dailyUse: 100, onHand: 150 })).toMatchObject({ daysLeft: 1.5, urgency: "NOW" });
    expect(planItem({ ...base, dailyUse: 100, onHand: 500 }).urgency).toBe("SOON"); // 5 days: lead 2 + half the cover
    expect(planItem({ ...base, dailyUse: 100, onHand: 700 })).toMatchObject({ daysLeft: 7, urgency: "OK", quantity: 200 });
  });
  it("is calm when the order is already on its way", () => {
    expect(planItem({ ...base, dailyUse: 100, onHand: 100, onOrder: 800 })).toMatchObject({ quantity: 0, urgency: "OK" });
  });
  it("without use, goes by the reorder level", () => {
    expect(planItem({ ...base, reorderLevel: 500, onHand: 0 }).urgency).toBe("NOW");
    expect(planItem({ ...base, reorderLevel: 500, onHand: 300 }).urgency).toBe("SOON");
  });
  it("sorts the most urgent first", () => {
    const rows = [{ urgency: "OK" as const, name: "A" }, { urgency: "NOW" as const, name: "Z" }, { urgency: "SOON" as const, name: "M" }, { urgency: "NOW" as const, name: "B" }];
    expect(rows.sort(byUrgency).map((r) => r.name)).toEqual(["B", "Z", "M", "A"]);
  });
});

describe("showing amounts", () => {
  it("uses kilograms, litres and pieces", () => {
    expect(showQty(450, "g")).toBe("450 g");
    expect(showQty(2500, "g")).toBe("2.5 kg");
    expect(showQty(3000, "ml")).toBe("3 L");
    expect(showQty(12, "piece")).toBe("12 pc");
  });
});
