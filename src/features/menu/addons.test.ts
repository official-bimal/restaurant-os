import { describe, expect, it } from "vitest";
import { resolveAddOns, type AddOnGroupRule } from "./addons";

const size: AddOnGroupRule = {
  id: "g-size",
  name: "Size",
  required: true,
  multiple: false,
  choices: [
    { id: "s", name: "Small", price: 0 },
    { id: "l", name: "Large", price: 5_000 },
  ],
};
const extras: AddOnGroupRule = {
  id: "g-extra",
  name: "Extras",
  required: false,
  multiple: true,
  choices: [
    { id: "cheese", name: "Extra cheese", price: 3_000 },
    { id: "egg", name: "Egg", price: 2_500 },
  ],
};

describe("resolveAddOns", () => {
  it("adds up the chosen extras", () => {
    const r = resolveAddOns([size, extras], ["l", "cheese", "egg"]);
    expect(r.extra).toBe(10_500);
    expect(r.chosen.map((c) => c.name)).toEqual(["Large", "Extra cheese", "Egg"]);
  });

  it("allows skipping an optional group but not a required one", () => {
    expect(resolveAddOns([size, extras], ["s"]).extra).toBe(0);
    expect(() => resolveAddOns([size, extras], ["cheese"])).toThrow(/Size/);
  });

  it("allows only one choice in a single-choice group", () => {
    expect(() => resolveAddOns([size], ["s", "l"])).toThrow(/only one/);
  });

  it("refuses an option that does not belong to the dish", () => {
    expect(() => resolveAddOns([size], ["s", "nope"])).toThrow(/not available/);
  });

  it("ignores a repeated id and orders by group", () => {
    const r = resolveAddOns([size, extras], ["egg", "l", "l"]);
    expect(r.chosen.map((c) => c.id)).toEqual(["l", "egg"]);
  });

  it("needs nothing when the dish has no groups", () => {
    expect(resolveAddOns([], [])).toEqual({ chosen: [], extra: 0 });
    expect(() => resolveAddOns([], ["x"])).toThrow();
  });
});
