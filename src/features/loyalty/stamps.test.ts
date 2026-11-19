import { describe, expect, it } from "vitest";
import { cardState, countStamps, qualifies } from "./stamps";

describe("stamp cards", () => {
  it("counts the card being filled and the free dishes ready", () => {
    expect(cardState(0, 0, 10)).toEqual({ stamps: 0, redeemed: 0, inCard: 0, available: 0, toGo: 10 });
    expect(cardState(7, 0, 10)).toMatchObject({ inCard: 7, available: 0, toGo: 3 });
    expect(cardState(10, 0, 10)).toMatchObject({ inCard: 0, available: 1, toGo: 0 });
    expect(cardState(23, 0, 10)).toMatchObject({ inCard: 3, available: 2 });
  });
  it("takes away the free dishes already given", () => {
    expect(cardState(10, 1, 10)).toMatchObject({ inCard: 0, available: 0, toGo: 10 });
    expect(cardState(23, 1, 10)).toMatchObject({ inCard: 3, available: 1 });
    // More given than earned (stamps were refunded): never negative.
    expect(cardState(5, 2, 10)).toMatchObject({ inCard: 0, available: 0, toGo: 10 });
  });
  it("works for a card of one stamp", () => {
    expect(cardState(3, 1, 1)).toMatchObject({ available: 2, inCard: 0 });
  });
  it("decides which dishes earn stamps", () => {
    expect(qualifies([], { menuItemId: "x", categoryId: null })).toBe(true);
    expect(qualifies([{ menuItemId: null, categoryId: "coffee" }], { menuItemId: "a", categoryId: "coffee" })).toBe(true);
    expect(qualifies([{ menuItemId: null, categoryId: "coffee" }], { menuItemId: "a", categoryId: "snack" })).toBe(false);
    expect(qualifies([{ menuItemId: "a", categoryId: null }], { menuItemId: "a", categoryId: "snack" })).toBe(true);
  });
  it("counts paid units of qualifying dishes only", () => {
    const items = [{ menuItemId: null, categoryId: "coffee" }];
    const bought = [
      { menuItemId: "a", categoryId: "coffee", quantity: 2, complimentary: false },
      { menuItemId: "b", categoryId: "snack", quantity: 5, complimentary: false },
      { menuItemId: "a", categoryId: "coffee", quantity: 1, complimentary: true },
      { menuItemId: "c", categoryId: "coffee", quantity: 3, complimentary: false },
    ];
    expect(countStamps(items, bought)).toBe(5);
    expect(countStamps([], bought)).toBe(10);
  });
});
