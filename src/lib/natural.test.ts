import { describe, expect, it } from "vitest";
import { naturalCompare, sortNatural } from "./natural";
import { gridPositions, snap } from "./floor-plan";

describe("table names in counting order", () => {
  it("puts T2 before T10, which letter order gets wrong", () => {
    const names = ["T10", "T1", "T2", "T11", "T3"];
    expect([...names].sort()).toEqual(["T1", "T10", "T11", "T2", "T3"]);
    expect(sortNatural(names, (n) => n)).toEqual(["T1", "T2", "T3", "T10", "T11"]);
  });
  it("ignores case and handles plain words and mixed names", () => {
    expect(sortNatural(["table 10", "Table 2", "Bar", "bar 1", "A1"], (n) => n)).toEqual(["A1", "Bar", "bar 1", "Table 2", "table 10"]);
    expect(naturalCompare("T2", "t2")).toBe(0);
  });
  it("does not change the list it is given", () => {
    const a = ["b", "a"];
    sortNatural(a, (x) => x);
    expect(a).toEqual(["b", "a"]);
  });
});

describe("arranging the plan", () => {
  it("fills a grid left to right, row by row, so tables read 1 2 3 across", () => {
    const g = gridPositions(6, 3);
    expect(g).toHaveLength(6);
    expect(g[0]!.y).toBe(g[1]!.y);
    expect(g[0]!.x).toBeLessThan(g[1]!.x);
    expect(g[1]!.x).toBeLessThan(g[2]!.x);
    expect(g[3]!.y).toBeGreaterThan(g[0]!.y);
    expect(g[3]!.x).toBe(g[0]!.x);
  });
  it("uses a sensible number per row when asked for automatic, and never more than the tables", () => {
    expect(gridPositions(1, 0)).toHaveLength(1);
    expect(new Set(gridPositions(7, 0).map((p) => p.y)).size).toBeGreaterThan(1);
    expect(new Set(gridPositions(3, 8).map((p) => p.y)).size).toBe(1);
    expect(gridPositions(0, 3)).toEqual([]);
  });
  it("keeps every position on the plan", () => {
    for (const p of gridPositions(40, 5)) {
      expect(p.x).toBeGreaterThanOrEqual(60);
      expect(p.x).toBeLessThanOrEqual(940);
      expect(p.y).toBeGreaterThanOrEqual(60);
      expect(p.y).toBeLessThanOrEqual(940);
    }
  });
  it("snaps a dragged position to the grid and keeps it on the plan", () => {
    expect(snap(512)).toBe(500);
    expect(snap(513)).toBe(525);
    expect(snap(5)).toBe(60);
    expect(snap(990)).toBe(940);
  });
});
