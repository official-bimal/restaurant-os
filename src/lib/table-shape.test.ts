import { describe, expect, it } from "vitest";
import { MAX_SEATS, MIN_SEATS, seatCount, tableShape, type Seat, type TableBody } from "./table-shape";

const inside = (s: Seat, w: number, h: number) => s.x >= -0.01 && s.y >= -0.01 && s.x + s.w <= w + 0.01 && s.y + s.h <= h + 0.01;

/** Does a seat's box overlap the table body? (Chairs sit around the table, never on it.) */
function overlapsBody(s: Seat, b: TableBody): boolean {
  if (b.kind === "rect") return s.x < b.x + b.w && s.x + s.w > b.x && s.y < b.y + b.h && s.y + s.h > b.y;
  // For a round table compare the chair's centre with the table's edge, allowing for the chair's own depth.
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  return Math.hypot(cx - b.cx, cy - b.cy) < b.r + s.h / 2 - 0.01;
}

describe("seatCount", () => {
  it("is the capacity, kept between a pair and the most that fits", () => {
    expect(seatCount(4)).toBe(4);
    expect(seatCount(1)).toBe(MIN_SEATS);
    expect(seatCount(0)).toBe(MIN_SEATS);
    expect(seatCount(-3)).toBe(MIN_SEATS);
    expect(seatCount(100)).toBe(MAX_SEATS);
    expect(seatCount(4.6)).toBe(5);
    expect(seatCount(Number.NaN)).toBe(4);
  });
});

describe("tableShape", () => {
  it("draws a chair for every seat, for every capacity", () => {
    for (let c = 1; c <= 20; c++) expect(tableShape(c).seats).toHaveLength(seatCount(c));
  });

  it("uses a round table for small parties and a long table for big ones", () => {
    for (const c of [2, 3, 4, 5, 6]) expect(tableShape(c).body.kind).toBe("circle");
    for (const c of [7, 8, 10, 12, 16]) expect(tableShape(c).body.kind).toBe("rect");
  });

  it("keeps every chair inside the picture and off the table", () => {
    for (let c = 1; c <= 20; c++) {
      const t = tableShape(c);
      for (const s of t.seats) {
        expect(inside(s, t.width, t.height), `capacity ${c}`).toBe(true);
        expect(overlapsBody(s, t.body), `capacity ${c}`).toBe(false);
      }
    }
  });

  it("puts the chairs of a long table on its two long sides, as evenly as it can", () => {
    const t = tableShape(8);
    const body = t.body as Extract<TableBody, { kind: "rect" }>;
    const above = t.seats.filter((s) => s.y + s.h <= body.y + 0.01);
    const below = t.seats.filter((s) => s.y >= body.y + body.h - 0.01);
    expect(above).toHaveLength(4);
    expect(below).toHaveLength(4);
    const odd = tableShape(9);
    const b2 = odd.body as Extract<TableBody, { kind: "rect" }>;
    expect(odd.seats.filter((s) => s.y + s.h <= b2.y + 0.01)).toHaveLength(5);
    expect(odd.seats.filter((s) => s.y >= b2.y + b2.h - 0.01)).toHaveLength(4);
  });

  it("makes a long table wider as it gets more chairs", () => {
    expect(tableShape(12).width).toBeGreaterThan(tableShape(8).width);
    expect(tableShape(16).width).toBeGreaterThan(tableShape(12).width);
  });

  it("never lets two chairs overlap each other", () => {
    for (let c = 2; c <= 16; c++) {
      const seats = tableShape(c).seats;
      for (let i = 0; i < seats.length; i++) {
        for (let j = i + 1; j < seats.length; j++) {
          const a = seats[i]!;
          const b = seats[j]!;
          // Distance between the chairs' centres must be at least a chair's depth (chairs on a ring are rotated, so use the circle bound).
          const d = Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
          expect(d, `capacity ${c}: ${i} vs ${j}`).toBeGreaterThan(a.h - 0.5);
        }
      }
    }
  });
});
