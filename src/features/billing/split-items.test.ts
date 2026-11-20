import { describe, expect, it } from "vitest";
import { cutPrice, dropGuests, everythingOnFirst, guestSubtotal, planSplit, shareName, sharedByAll, type Assignment, type SplitItem } from "./split-items";

const momo: SplitItem = { id: "momo", name: "Momo", unitPrice: 25_000, quantity: 3 };
const pizza: SplitItem = { id: "pizza", name: "Pizza", unitPrice: 100_000, quantity: 1 };
const tea: SplitItem = { id: "tea", name: "Tea", unitPrice: 8_000, quantity: 2 };
const total = (items: SplitItem[]) => items.reduce((n, i) => n + i.unitPrice * i.quantity, 0);

describe("cutting a price", () => {
  it("makes equal parts that add up, odd paisa to the first parts", () => {
    expect(cutPrice(100, 3)).toEqual([34, 33, 33]);
    expect(cutPrice(100_000, 4)).toEqual([25_000, 25_000, 25_000, 25_000]);
    expect(cutPrice(7, 3).reduce((a, b) => a + b, 0)).toBe(7);
    expect(cutPrice(0, 2)).toEqual([0, 0]);
    expect(cutPrice(5, 1)).toEqual([5]);
  });
  it("refuses nonsense", () => {
    expect(() => cutPrice(-1, 2)).toThrow();
    expect(() => cutPrice(1.5, 2)).toThrow();
    expect(() => cutPrice(10, 0)).toThrow();
  });
  it("names a share, and leaves a whole dish alone", () => {
    expect(shareName("Pizza", 3)).toBe("Pizza (1/3 share)");
    expect(shareName("Pizza", 1)).toBe("Pizza");
  });
});

describe("planning a split by item", () => {
  it("gives each guest what they took, and merges units that go the same way", () => {
    const items = [momo, tea];
    const a: Assignment[] = [
      { itemId: "momo", units: [[0], [0], [1]] },
      { itemId: "tea", units: [[1], [1]] },
    ];
    const lines = planSplit(items, a, 2);
    expect(lines).toEqual([
      { itemId: "momo", guest: 0, quantity: 2, unitPrice: 25_000, shareDen: 1 },
      { itemId: "momo", guest: 1, quantity: 1, unitPrice: 25_000, shareDen: 1 },
      { itemId: "tea", guest: 1, quantity: 2, unitPrice: 8_000, shareDen: 1 },
    ]);
    expect(guestSubtotal(lines, 0)).toBe(50_000);
    expect(guestSubtotal(lines, 1)).toBe(41_000);
  });

  it("shares a dish between guests so the parts add up to the dish", () => {
    const lines = planSplit([pizza, tea], [{ itemId: "pizza", units: [[0, 1, 2]] }, { itemId: "tea", units: [[0], [1]] }], 3);
    const pizzaLines = lines.filter((l) => l.itemId === "pizza");
    expect(pizzaLines.map((l) => l.shareDen)).toEqual([3, 3, 3]);
    expect(pizzaLines.map((l) => l.unitPrice)).toEqual([33_334, 33_333, 33_333]);
    expect(pizzaLines.reduce((n, l) => n + l.unitPrice * l.quantity, 0)).toBe(100_000);
  });

  it("keeps the grand total the same whatever the split", () => {
    const items = [momo, pizza, tea];
    for (const guests of [2, 3, 5]) {
      const lines = planSplit(items, sharedByAll(items, guests), guests);
      expect(lines.reduce((n, l) => n + l.quantity * l.unitPrice, 0)).toBe(total(items));
    }
    const mixed = planSplit(items, [{ itemId: "momo", units: [[0, 1], [1], [0]] }, { itemId: "pizza", units: [[1, 2]] }, { itemId: "tea", units: [[2], [0, 2]] }], 3);
    expect(mixed.reduce((n, l) => n + l.quantity * l.unitPrice, 0)).toBe(total(items));
  });

  it("shares several units the same way as one line", () => {
    const lines = planSplit([tea], [{ itemId: "tea", units: [[0, 1], [0, 1]] }], 2);
    expect(lines).toEqual([
      { itemId: "tea", guest: 0, quantity: 2, unitPrice: 4_000, shareDen: 2 },
      { itemId: "tea", guest: 1, quantity: 2, unitPrice: 4_000, shareDen: 2 },
    ]);
  });

  it("starts with everything on the first guest, and refuses a guest left with nothing", () => {
    const items = [momo, tea];
    expect(() => planSplit(items, everythingOnFirst(items), 2)).toThrow(/Guest 2 has nothing/);
    expect(guestSubtotal(planSplit(items, sharedByAll(items, 2), 2), 0)).toBeGreaterThan(0);
  });

  it("refuses anything that is not a clean split", () => {
    const ok: Assignment = { itemId: "tea", units: [[0], [1]] };
    expect(() => planSplit([tea], [ok], 1)).toThrow(/2 and 8/);
    expect(() => planSplit([tea], [ok], 9)).toThrow(/2 and 8/);
    expect(() => planSplit([tea], [], 2)).toThrow(/needs to be given/);
    expect(() => planSplit([tea], [ok, ok], 2)).toThrow(/twice/);
    expect(() => planSplit([tea], [{ itemId: "tea", units: [[0]] }], 2)).toThrow(/all 2/);
    expect(() => planSplit([tea], [{ itemId: "tea", units: [[0], []] }], 2)).toThrow(/someone has to take/);
    expect(() => planSplit([tea], [{ itemId: "tea", units: [[0], [5]] }], 2)).toThrow(/not on this bill/);
    expect(() => planSplit([tea], [{ itemId: "tea", units: [[0], [-1]] }], 2)).toThrow(/not on this bill/);
    expect(() => planSplit([tea], [{ itemId: "tea", units: [[0], [1, 1]] }], 2)).toThrow(/not on this bill/);
    expect(() => planSplit([tea], [{ itemId: "other", units: [[0], [1]] }], 2)).toThrow(/needs to be given/);
  });

  it("moves a removed guest's units back to the first guest or the remaining sharers", () => {
    const a: Assignment[] = [{ itemId: "x", units: [[2], [1, 2], [0]] }];
    expect(dropGuests(a, 2)).toEqual([{ itemId: "x", units: [[0], [1], [0]] }]);
  });
});
