import { describe, expect, it } from "vitest";
import { countTone, difference, isWasteReason, parseCounted, summarizeWaste, wasteReasonLabel } from "./count";

describe("counting", () => {
  it("compares the count with the book", () => {
    expect(difference(1000, 900)).toBe(-100);
    expect(difference(1000, 1000)).toBe(0);
    expect(countTone(-1)).toBe("short");
    expect(countTone(5)).toBe("over");
    expect(countTone(0)).toBe("same");
  });

  it("reads what was typed in a count box", () => {
    expect(parseCounted("")).toBeNull();
    expect(parseCounted("  ")).toBeNull();
    expect(parseCounted(undefined)).toBeNull();
    expect(parseCounted("0")).toBe(0);
    expect(parseCounted("1,250")).toBe(1250);
    expect(parseCounted("-3")).toBe("bad");
    expect(parseCounted("2.5")).toBe("bad");
    expect(parseCounted("abc")).toBe("bad");
    expect(parseCounted("12345678901")).toBe("bad");
  });
});

describe("waste", () => {
  it("knows its reasons", () => {
    expect(isWasteReason("SPOILED")).toBe(true);
    expect(isWasteReason("whatever")).toBe(false);
    expect(wasteReasonLabel("DROPPED")).toBe("Dropped or spilled");
    expect(wasteReasonLabel(null)).toBe("Not said");
  });

  it("adds waste up by cause and by item, biggest first", () => {
    const s = summarizeWaste([
      { stockItemId: "a", name: "Milk", unit: "ml", reason: "SPOILED", quantity: 1000, cost: 15000 },
      { stockItemId: "a", name: "Milk", unit: "ml", reason: "DROPPED", quantity: 500, cost: 7500 },
      { stockItemId: "b", name: "Flour", unit: "g", reason: "SPOILED", quantity: 2000, cost: 30000 },
      { stockItemId: "c", name: "Eggs", unit: "piece", reason: null, quantity: 3, cost: 4500 },
    ]);
    expect(s.total).toBe(57000);
    expect(s.byReason.map((r) => [r.label, r.cost, r.entries])).toEqual([
      ["Spoiled", 45000, 2],
      ["Dropped or spilled", 7500, 1],
      ["Not said", 4500, 1],
    ]);
    expect(s.byItem.map((i) => [i.name, i.quantity, i.cost])).toEqual([
      ["Flour", 2000, 30000],
      ["Milk", 1500, 22500],
      ["Eggs", 3, 4500],
    ]);
  });

  it("is empty for no waste", () => {
    expect(summarizeWaste([])).toEqual({ total: 0, byReason: [], byItem: [] });
  });
});
