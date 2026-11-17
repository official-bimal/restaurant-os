import { describe, expect, it } from "vitest";
import { pickBestSellers } from "./best-sellers";

const all = new Set(["a", "b", "c", "d", "e", "f", "g"]);

describe("pickBestSellers", () => {
  it("returns the top dishes, most sold first, at most five", () => {
    const sold = [
      { menuItemId: "a", quantity: 10 },
      { menuItemId: "b", quantity: 30 },
      { menuItemId: "c", quantity: 20 },
      { menuItemId: "d", quantity: 15 },
      { menuItemId: "e", quantity: 12 },
      { menuItemId: "f", quantity: 11 },
      { menuItemId: "g", quantity: 9 },
    ];
    expect(pickBestSellers(sold, all)).toEqual(["b", "c", "d", "e", "f"]);
  });
  it("adds up rows of the same dish", () => {
    expect(pickBestSellers([{ menuItemId: "a", quantity: 3 }, { menuItemId: "a", quantity: 4 }], all)).toEqual(["a"]);
  });
  it("ignores dishes that are not on the menu now, and dishes sold too few times", () => {
    const sold = [{ menuItemId: "gone", quantity: 99 }, { menuItemId: "a", quantity: 4 }, { menuItemId: "b", quantity: 5 }];
    expect(pickBestSellers(sold, all)).toEqual(["b"]);
  });
  it("shows nothing when nothing qualifies", () => {
    expect(pickBestSellers([], all)).toEqual([]);
    expect(pickBestSellers([{ menuItemId: "a", quantity: 1 }], all)).toEqual([]);
  });
  it("breaks ties the same way every time", () => {
    const sold = [{ menuItemId: "c", quantity: 6 }, { menuItemId: "a", quantity: 6 }, { menuItemId: "b", quantity: 6 }];
    expect(pickBestSellers(sold, all)).toEqual(["a", "b", "c"]);
    expect(pickBestSellers([...sold].reverse(), all)).toEqual(["a", "b", "c"]);
  });
  it("respects a custom limit and minimum", () => {
    const sold = [{ menuItemId: "a", quantity: 2 }, { menuItemId: "b", quantity: 3 }];
    expect(pickBestSellers(sold, all, { limit: 1, minUnits: 1 })).toEqual(["b"]);
  });
});
