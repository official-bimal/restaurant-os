import { describe, expect, it } from "vitest";
import { canMoveDelivery, cleanDelivery } from "./delivery";

describe("cleanDelivery", () => {
  it("needs a callable phone and an address", () => {
    expect(cleanDelivery({ name: "  Sita  Rai ", phone: "+977 984-1234567", address: "House 4,   Lakeside" })).toEqual({
      name: "Sita Rai",
      phone: "+977 984-1234567",
      address: "House 4, Lakeside",
    });
    expect(() => cleanDelivery({ phone: "123", address: "House 4, Lakeside" })).toThrow(/phone/);
    expect(() => cleanDelivery({ phone: "9841234567", address: "x" })).toThrow(/address/);
    expect(() => cleanDelivery(undefined)).toThrow();
    expect(() => cleanDelivery({ phone: "call me maybe 12345678", address: "House 4, Lakeside" })).toThrow(/phone/);
  });
  it("name is optional", () => {
    expect(cleanDelivery({ phone: "9841234567", address: "House 4, Lakeside" }).name).toBeNull();
  });
});

describe("canMoveDelivery", () => {
  it("only moves forward", () => {
    expect(canMoveDelivery("PREPARING", "OUT_FOR_DELIVERY")).toBe(true);
    expect(canMoveDelivery("OUT_FOR_DELIVERY", "DELIVERED")).toBe(true);
    expect(canMoveDelivery("PREPARING", "DELIVERED")).toBe(false);
    expect(canMoveDelivery("DELIVERED", "FAILED")).toBe(false);
    expect(canMoveDelivery("FAILED", "OUT_FOR_DELIVERY")).toBe(false);
  });
});

import { feeForDistance, formatKm, kmToMeters } from "./delivery";

describe("distance bands", () => {
  const bands = [
    { upToMeters: 5_000, fee: 20_000 },
    { upToMeters: 2_000, fee: 10_000 },
    { upToMeters: 10_000, fee: 40_000 },
  ];
  it("picks the first band that reaches the distance, whatever order they were added in", () => {
    expect(feeForDistance(bands, 500)).toEqual({ fee: 10_000, upToMeters: 2_000 });
    expect(feeForDistance(bands, 2_000)).toEqual({ fee: 10_000, upToMeters: 2_000 });
    expect(feeForDistance(bands, 2_001)).toEqual({ fee: 20_000, upToMeters: 5_000 });
    expect(feeForDistance(bands, 10_000)).toEqual({ fee: 40_000, upToMeters: 10_000 });
  });
  it("is outside the range beyond the last band", () => {
    expect(feeForDistance(bands, 10_001)).toBeNull();
    expect(feeForDistance([], 100)).toBeNull();
  });
  it("turns typed kilometres into metres and refuses nonsense", () => {
    expect(kmToMeters("2.5")).toBe(2_500);
    expect(kmToMeters(0.35)).toBe(350);
    for (const bad of [0, -1, "abc", "", 500, NaN]) expect(() => kmToMeters(bad)).toThrow(/distance/i);
    expect(formatKm(2_500)).toBe("2.5 km");
  });
});
