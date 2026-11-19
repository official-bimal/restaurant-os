/**
 * How a table is drawn on the floor map: a round table with chairs around it for small parties, a long table with chairs along both
 * sides for big ones. Pure geometry, no drawing code: it returns shapes in a 0..height by 0..width box that the map draws as SVG.
 * The seat count comes from the table's capacity.
 */

export interface Seat {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, around the seat's own centre. */
  rotate: number;
}

export type TableBody = { kind: "circle"; cx: number; cy: number; r: number } | { kind: "rect"; x: number; y: number; w: number; h: number };

export interface TableShape {
  width: number;
  height: number;
  body: TableBody;
  seats: Seat[];
}

export const MIN_SEATS = 2;
export const MAX_SEATS = 16;

const SEAT_W = 18;
const SEAT_H = 9;
const HEIGHT = 100;

/** Chairs shown for a capacity: at least a pair, and never more than fit around one table. */
export function seatCount(capacity: number): number {
  if (!Number.isFinite(capacity)) return 4;
  return Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.round(capacity)));
}

function roundTable(n: number): TableShape {
  // Up to 4 guests: a small round table. 5 and 6: a bigger one, with its chairs pushed out to match.
  const r = n <= 4 ? 21 : 27;
  const ring = r + 5 + SEAT_H / 2;
  const seats: Seat[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2; // the first chair is at the top
    const x = 50 + ring * Math.cos(angle);
    const y = 50 + ring * Math.sin(angle);
    seats.push({ x: x - SEAT_W / 2, y: y - SEAT_H / 2, w: SEAT_W, h: SEAT_H, rotate: (angle * 180) / Math.PI + 90 });
  }
  return { width: HEIGHT, height: HEIGHT, body: { kind: "circle", cx: 50, cy: 50, r }, seats };
}

function longTable(n: number): TableShape {
  const top = Math.ceil(n / 2);
  const bottom = n - top;
  const perSide = top;
  const pitch = SEAT_W + 6;
  const bodyW = Math.max(60, perSide * pitch + 6);
  const width = bodyW + 2 * (SEAT_H + 8);
  const bodyX = (width - bodyW) / 2;
  const bodyY = 30;
  const bodyH = 40;
  const seats: Seat[] = [];
  const row = (count: number, y: number) => {
    const span = count * pitch - 6;
    const start = bodyX + (bodyW - span) / 2;
    for (let i = 0; i < count; i++) seats.push({ x: start + i * pitch, y, w: SEAT_W, h: SEAT_H, rotate: 0 });
  };
  row(top, bodyY - SEAT_H - 4);
  row(bottom, bodyY + bodyH + 4);
  return { width, height: HEIGHT, body: { kind: "rect", x: bodyX, y: bodyY, w: bodyW, h: bodyH }, seats };
}

export function tableShape(capacity: number): TableShape {
  const n = seatCount(capacity);
  return n <= 6 ? roundTable(n) : longTable(n);
}
