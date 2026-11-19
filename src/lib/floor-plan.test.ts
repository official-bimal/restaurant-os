import { describe, expect, it } from "vitest";
import { clampPos, defaultPosition, hasPlan, PLAN_MAX, PLAN_MIN, planWidthPercent, resolvePlan } from "./floor-plan";

describe("floor plan", () => {
  it("keeps positions inside the plan", () => {
    expect(clampPos(-50)).toBe(PLAN_MIN);
    expect(clampPos(5000)).toBe(PLAN_MAX);
    expect(clampPos(512.4)).toBe(512);
    expect(clampPos(NaN)).toBe(500);
  });
  it("gives every unplaced table its own grid slot inside the plan", () => {
    const slots = Array.from({ length: 7 }, (_, i) => defaultPosition(i, 7));
    expect(new Set(slots.map((s) => `${s.x},${s.y}`)).size).toBe(7);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(PLAN_MIN);
      expect(s.x).toBeLessThanOrEqual(PLAN_MAX);
      expect(s.y).toBeGreaterThanOrEqual(PLAN_MIN);
      expect(s.y).toBeLessThanOrEqual(PLAN_MAX);
    }
    expect(defaultPosition(0, 1)).toEqual({ x: 500, y: 500 });
  });
  it("uses a saved place and falls back to the grid for the rest", () => {
    const tables = [
      { id: "a", posX: 100, posY: 200 },
      { id: "b", posX: null, posY: null },
      { id: "c", posX: 5000, posY: 10 },
    ];
    const p = resolvePlan(tables);
    expect(p.get("a")).toEqual({ x: 100, y: 200 });
    expect(p.get("b")).toEqual(defaultPosition(1, 3));
    expect(p.get("c")).toEqual({ x: PLAN_MAX, y: PLAN_MIN });
  });
  it("an area has a plan once one table is placed", () => {
    expect(hasPlan([{ id: "a", posX: null, posY: null }])).toBe(false);
    expect(hasPlan([{ id: "a", posX: 1, posY: 1 }, { id: "b", posX: null, posY: null }])).toBe(true);
    expect(hasPlan([{ id: "a", posX: 5, posY: null }])).toBe(false);
  });
  it("draws long tables wider", () => {
    expect(planWidthPercent(4)).toBeLessThan(planWidthPercent(8));
  });
});
