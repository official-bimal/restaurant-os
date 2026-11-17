import { describe, expect, it } from "vitest";
import { groupByStation, paperWidth, receiptLines, type PrintItem } from "./receipt";

const item = (o: Partial<PrintItem> = {}): PrintItem => ({ name: "Momo", quantity: 2, unitPrice: 20_000, complimentary: false, note: null, status: "PENDING", addOns: [], ...o });

describe("receiptLines", () => {
  it("totals each line, hides cancelled items and shows complimentary ones at no charge", () => {
    const lines = receiptLines([item(), item({ name: "Tea", quantity: 1, unitPrice: 8_000, complimentary: true }), item({ name: "Gone", status: "CANCELLED" })]);
    expect(lines.map((l) => [l.name, l.total])).toEqual([["Momo", 40_000], ["Tea", 0]]);
    expect(lines[1]!.complimentary).toBe(true);
  });
  it("carries notes and add-on names", () => {
    const [l] = receiptLines([item({ note: "no onion", addOns: [{ name: "Cheese", price: 3_000 }] })]);
    expect(l).toMatchObject({ note: "no onion", addOns: ["Cheese"] });
  });
});

describe("paperWidth", () => {
  it("accepts 58 and 80 and falls back to 80", () => {
    expect(paperWidth("58")).toBe(58);
    expect(paperWidth(["80"])).toBe(80);
    for (const bad of [undefined, "", "100", "abc", "0"]) expect(paperWidth(bad)).toBe(80);
  });
});

describe("groupByStation", () => {
  it("groups by station in first-seen order, naming unassigned dishes Other, skipping cancelled", () => {
    const g = groupByStation([
      { id: 1, status: "PENDING", station: "Grill" },
      { id: 2, status: "PENDING", station: null },
      { id: 3, status: "CANCELLED", station: "Grill" },
      { id: 4, status: "PREPARING", station: "Grill" },
    ]);
    expect(g.map((x) => [x.station, x.items.map((i) => i.id)])).toEqual([["Grill", [1, 4]], ["Other", [2]]]);
  });
});
