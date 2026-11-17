import { afterEach, describe, expect, it, vi } from "vitest";
import { distanceBetween, estimateRoadMeters, haversineMeters, offsetMeters, parseLocation, routeMeters } from "./geo";

const thamel = { lat: 27.7154, lng: 85.3123 };
const patan = { lat: 27.6766, lng: 85.3142 };

describe("parseLocation", () => {
  it("reads typed coordinates", () => {
    expect(parseLocation("27.7172, 85.324")).toEqual({ lat: 27.7172, lng: 85.324 });
    expect(parseLocation("27.7172 85.324")).toEqual({ lat: 27.7172, lng: 85.324 });
    expect(parseLocation("-33.8688,151.2093")).toEqual({ lat: -33.8688, lng: 151.2093 });
    expect(parseLocation("geo:27.7172,85.324?z=16")).toEqual({ lat: 27.7172, lng: 85.324 });
  });
  it("reads links copied from map apps", () => {
    expect(parseLocation("https://www.google.com/maps/place/Thamel/@27.7154,85.3123,17z/data=!3m1")).toEqual(thamel);
    expect(parseLocation("https://www.google.com/maps?q=27.7154,85.3123")).toEqual(thamel);
    expect(parseLocation("https://www.google.com/maps/dir//27.7154%2C85.3123")).toBeNull(); // no q= or @: not a point we can trust
    expect(parseLocation("https://maps.google.com/?ll=27.7154,85.3123&z=16")).toEqual(thamel);
    expect(parseLocation("https://www.google.com/maps/place/x/data=!4m2!3d27.7154!4d85.3123")).toEqual(thamel);
    expect(parseLocation("https://www.openstreetmap.org/?mlat=27.7154&mlon=85.3123#map=16/27.7154/85.3123")).toEqual(thamel);
    expect(parseLocation("https://www.openstreetmap.org/#map=16/27.7154/85.3123")).toEqual(thamel);
  });
  it("refuses what it cannot read or that is out of range", () => {
    for (const bad of ["", "   ", "Thamel, Kathmandu", "91,10", "10,181", "https://maps.app.goo.gl/abc123", "27.7", "a,b", "x".repeat(700)]) {
      expect(parseLocation(bad)).toBeNull();
    }
    expect(parseLocation(null)).toBeNull();
  });
});

describe("distance", () => {
  it("measures the straight line", () => {
    expect(haversineMeters(thamel, thamel)).toBe(0);
    const d = haversineMeters(thamel, patan);
    expect(d).toBeGreaterThan(4_200);
    expect(d).toBeLessThan(4_500);
    expect(haversineMeters(thamel, patan)).toBe(haversineMeters(patan, thamel));
  });
  it("stretches it by the road factor, within sensible limits", () => {
    const straight = haversineMeters(thamel, patan);
    expect(estimateRoadMeters(thamel, patan, 130)).toBe(Math.round(straight * 1.3));
    expect(estimateRoadMeters(thamel, patan, 50)).toBe(straight); // never shorter than the straight line
    expect(estimateRoadMeters(thamel, patan, 9999)).toBe(Math.round(straight * 3));
    expect(estimateRoadMeters(thamel, patan, NaN)).toBe(Math.round(straight * 1.3));
  });
  it("places a point east and north of a centre for drawing", () => {
    const o = offsetMeters(thamel, patan);
    expect(o.north).toBeLessThan(-4_000); // patan is south
    expect(Math.abs(o.east)).toBeLessThan(300);
    expect(offsetMeters(thamel, { lat: thamel.lat + 0.01, lng: thamel.lng + 0.01 })).toMatchObject({ north: expect.any(Number) });
    const ne = offsetMeters(thamel, { lat: thamel.lat + 0.01, lng: thamel.lng + 0.01 });
    expect(ne.north).toBeGreaterThan(0);
    expect(ne.east).toBeGreaterThan(0);
  });
});

describe("routing server", () => {
  afterEach(() => {
    delete process.env.ROUTING_URL;
  });
  const ok = (distance: number) => (async () => new Response(JSON.stringify({ code: "Ok", routes: [{ distance }] }))) as unknown as typeof fetch;

  it("is off unless configured, and the estimate is used", async () => {
    expect(await routeMeters(thamel, patan, ok(9_999))).toBeNull();
    const r = await distanceBetween(thamel, patan, 130, ok(9_999));
    expect(r.method).toBe("estimate");
  });
  it("uses the real road distance when it answers, sending only coordinates", async () => {
    process.env.ROUTING_URL = "https://routing.example.test/";
    const spy = vi.fn(ok(5_432));
    const r = await distanceBetween(thamel, patan, 130, spy as unknown as typeof fetch);
    expect(r).toEqual({ meters: 5_432, method: "route" });
    const url = String(spy.mock.calls[0]![0]);
    expect(url).toBe("https://routing.example.test/route/v1/driving/85.3123,27.7154;85.3142,27.6766?overview=false");
  });
  it("falls back to the estimate when the server is down, slow, or answers badly", async () => {
    process.env.ROUTING_URL = "https://routing.example.test";
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const bad = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const weird = (async () => new Response(JSON.stringify({ code: "NoRoute" }))) as unknown as typeof fetch;
    for (const f of [down, bad, weird]) expect((await distanceBetween(thamel, patan, 130, f)).method).toBe("estimate");
  });
});

import { fitPoints } from "./geo";

describe("fitPoints", () => {
  it("keeps north up, fits inside the drawing and shares one scale", () => {
    const a = { lat: 27.71, lng: 85.31 };
    const b = { lat: 27.68, lng: 85.33 }; // south and east of a
    const { xy, metersPerPixel } = fitPoints([a, b], 400, 240, 30);
    expect(xy[1]!.y).toBeGreaterThan(xy[0]!.y); // south is lower on the page
    expect(xy[1]!.x).toBeGreaterThan(xy[0]!.x); // east is to the right
    for (const p of xy) {
      expect(p.x).toBeGreaterThanOrEqual(30 - 1);
      expect(p.x).toBeLessThanOrEqual(370 + 1);
      expect(p.y).toBeGreaterThanOrEqual(30 - 1);
      expect(p.y).toBeLessThanOrEqual(210 + 1);
    }
    // the distance between the dots on the page matches the real distance
    const px = Math.hypot(xy[1]!.x - xy[0]!.x, xy[1]!.y - xy[0]!.y) * metersPerPixel;
    expect(px / haversineMeters(a, b)).toBeCloseTo(1, 1);
  });
  it("puts a single point in the middle and handles nothing", () => {
    expect(fitPoints([{ lat: 1, lng: 1 }], 400, 240, 30).xy[0]).toEqual({ x: 200, y: 120 });
    expect(fitPoints([], 400, 240, 30).xy).toEqual([]);
  });
});
