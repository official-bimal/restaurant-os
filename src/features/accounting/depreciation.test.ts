import { describe, expect, it } from "vitest";
import { yearlyDepreciation } from "./depreciation";

const FY = { from: "2026-07-17", to: "2027-07-16" };
const asset = { cost: 1_000_000, accumulated: 0, rateBps: 2_000, purchaseDate: "2020-01-01", disposedOn: null };

describe("depreciation", () => {
  it("takes the rate of the value left for a full year", () => {
    expect(yearlyDepreciation(asset, FY.from, FY.to)).toBe(200_000);
    expect(yearlyDepreciation({ ...asset, accumulated: 200_000 }, FY.from, FY.to)).toBe(160_000);
  });
  it("takes only the part of the year it was owned", () => {
    // Bought with 73 of 365 days left in the year: a fifth of the year.
    const d = yearlyDepreciation({ ...asset, purchaseDate: "2027-05-05" }, FY.from, FY.to);
    expect(d).toBe(Math.round(200_000 * (73 / 365)));
  });
  it("stops once sold, and before it was bought", () => {
    expect(yearlyDepreciation({ ...asset, disposedOn: "2026-07-16" }, FY.from, FY.to)).toBe(0);
    expect(yearlyDepreciation({ ...asset, purchaseDate: "2028-01-01" }, FY.from, FY.to)).toBe(0);
  });
  it("never takes more than the value left", () => {
    expect(yearlyDepreciation({ ...asset, accumulated: 999_900, rateBps: 10_000 }, FY.from, FY.to)).toBe(100);
    expect(yearlyDepreciation({ ...asset, accumulated: 1_000_000 }, FY.from, FY.to)).toBe(0);
  });
});
