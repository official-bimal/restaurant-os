import { describe, expect, it } from "vitest";
import { checkClockIn, clampRadius, distanceFromBranch, MAX_ACCURACY_M, parseClockLocation } from "./clock-location";

const cafe = { name: "Lakeside", latitude: 28.2096, longitude: 83.9856, radius: 150 };
// roughly 0.001 degrees of latitude is 111 m
const at = (dLat: number, accuracy = 10) => ({ lat: cafe.latitude + dLat, lng: cafe.longitude, accuracy });

describe("parseClockLocation", () => {
  it("accepts a sensible reading and refuses anything else", () => {
    expect(parseClockLocation({ lat: 28.2, lng: 83.9, accuracy: 12 })).toEqual({ lat: 28.2, lng: 83.9, accuracy: 12 });
    for (const bad of [null, undefined, "x", {}, { lat: 91, lng: 0, accuracy: 1 }, { lat: 0, lng: 181, accuracy: 1 }, { lat: 0, lng: 0, accuracy: -1 }, { lat: "1", lng: 0, accuracy: 1 }, { lat: Number.NaN, lng: 0, accuracy: 1 }, { lat: 0, lng: 0 }]) {
      expect(parseClockLocation(bad)).toBeNull();
    }
  });
});

describe("checkClockIn", () => {
  it("lets someone at the cafe clock in and reports how far they were", () => {
    const r = checkClockIn(cafe, at(0.0003));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.distance).toBeGreaterThan(20);
    if (r.ok) expect(r.distance).toBeLessThan(60);
  });
  it("refuses someone too far away, saying how far", () => {
    const r = checkClockIn(cafe, at(0.005)); // about 550 m
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/about \d{3} m from Lakeside/);
  });
  it("uses the branch's own radius", () => {
    expect(checkClockIn({ ...cafe, radius: 30 }, at(0.0005)).ok).toBe(false); // about 55 m
    expect(checkClockIn({ ...cafe, radius: 300 }, at(0.0015)).ok).toBe(true); // about 165 m
  });
  it("refuses a reading that is not exact enough, even if it is close", () => {
    const r = checkClockIn(cafe, at(0, MAX_ACCURACY_M + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not exact enough/);
    expect(checkClockIn(cafe, at(0, MAX_ACCURACY_M)).ok).toBe(true);
  });
  it("asks for location when none was given, and for the branch to have one", () => {
    expect(checkClockIn(cafe, null)).toMatchObject({ ok: false, reason: expect.stringMatching(/Allow location/) });
    expect(checkClockIn({ ...cafe, latitude: null }, at(0))).toMatchObject({ ok: false, reason: expect.stringMatching(/no location yet/) });
  });
});

describe("distanceFromBranch and clampRadius", () => {
  it("is null without a reading or a branch location", () => {
    expect(distanceFromBranch(cafe, null)).toBeNull();
    expect(distanceFromBranch({ ...cafe, longitude: null }, at(0))).toBeNull();
    expect(distanceFromBranch(cafe, at(0))).toBe(0);
  });
  it("keeps the radius between 30 and 1000 metres", () => {
    expect([clampRadius(5), clampRadius(150.4), clampRadius(5000)]).toEqual([30, 150, 1000]);
  });
});
