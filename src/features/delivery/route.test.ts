import { describe, expect, it } from "vitest";
import { haversineMeters } from "./geo";
import { planRoute } from "./route";

const start = { lat: 27.7, lng: 85.3 };
// Stops laid out roughly along a line going east from the start, so the sensible order is obvious.
const near = { lat: 27.7, lng: 85.31 };
const mid = { lat: 27.7, lng: 85.33 };
const far = { lat: 27.7, lng: 85.36 };

describe("planRoute", () => {
  it("visits stops nearest first along a line", () => {
    const r = planRoute(start, [{ id: "far", point: far }, { id: "near", point: near }, { id: "mid", point: mid }], 100);
    expect(r.order).toEqual(["near", "mid", "far"]);
    expect(r.meters).toBeCloseTo(haversineMeters(start, far), -1); // a straight line: the trip is the distance to the last stop
  });

  it("puts stops with no location last, in the order given", () => {
    const r = planRoute(start, [{ id: "x", point: null }, { id: "near", point: near }, { id: "y", point: null }], 130);
    expect(r.order).toEqual(["near", "x", "y"]);
  });

  it("stretches by the road factor", () => {
    const straight = planRoute(start, [{ id: "a", point: far }], 100).meters;
    const roads = planRoute(start, [{ id: "a", point: far }], 150).meters;
    expect(roads).toBeCloseTo(straight * 1.5, -1);
  });

  it("is never longer than visiting in the order given, and handles no stops and one", () => {
    // a zig-zag set where first-come order is clearly worse
    const pts = [
      { id: "a", point: { lat: 27.7, lng: 85.36 } },
      { id: "b", point: { lat: 27.7, lng: 85.31 } },
      { id: "c", point: { lat: 27.7, lng: 85.35 } },
      { id: "d", point: { lat: 27.7, lng: 85.32 } },
    ];
    const planned = planRoute(start, pts, 100);
    let given = 0;
    let at = start;
    for (const p of pts) {
      given += haversineMeters(at, p.point!);
      at = p.point!;
    }
    expect(planned.meters).toBeLessThanOrEqual(Math.round(given));
    expect(planned.order).toHaveLength(4);
    expect(new Set(planned.order).size).toBe(4);
    expect(planRoute(start, [], 130)).toEqual({ order: [], meters: 0 });
    expect(planRoute(start, [{ id: "only", point: near }], 130).order).toEqual(["only"]);
  });

  it("untangles a crossing route with 2-opt", () => {
    // from the origin, nearest-first goes to the closest point and can end up crossing; the result must be as short as the best order
    const stops = [
      { id: "1", point: { lat: 27.7, lng: 85.32 } },
      { id: "2", point: { lat: 27.72, lng: 85.32 } },
      { id: "3", point: { lat: 27.72, lng: 85.3 } },
      { id: "4", point: { lat: 27.7, lng: 85.3005 } },
    ];
    const r = planRoute(start, stops, 100);
    // brute force every order for the true minimum
    const perms = (a: string[]): string[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
    const byId = new Map(stops.map((s) => [s.id, s.point]));
    const len = (o: string[]) => {
      let t = 0;
      let at = start;
      for (const id of o) {
        t += haversineMeters(at, byId.get(id)!);
        at = byId.get(id)!;
      }
      return t;
    };
    const best = Math.min(...perms(["1", "2", "3", "4"]).map(len));
    expect(len(r.order)).toBeLessThanOrEqual(best * 1.03); // within a whisker of the true best
  });
});
