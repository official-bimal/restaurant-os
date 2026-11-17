import { estimateRoadMeters, type Point } from "./geo";

/**
 * Planning the order to visit several delivery stops, pure. It does not use a routing service: legs are straight-line
 * distances stretched by the business's road factor, which is close enough to put stops in a sensible order and to quote
 * a rough length for the trip. Stops without a known location go last, in the order given.
 */

export interface Stop {
  id: string;
  point: Point | null;
}

const MAX_STOPS = 25;

function tourMeters(start: Point, order: Point[], factorPct: number): number {
  let total = 0;
  let from = start;
  for (const p of order) {
    total += estimateRoadMeters(from, p, factorPct);
    from = p;
  }
  return total;
}

/**
 * Visit the stops that have a location in a short order, starting at `start` and ending at the last stop (the rider does
 * not have to come back here). Nearest-neighbour first, then 2-opt swaps while they shorten the trip.
 */
export function planRoute(start: Point, stops: Stop[], factorPct: number): { order: string[]; meters: number } {
  const located = stops.filter((s): s is { id: string; point: Point } => s.point !== null).slice(0, MAX_STOPS);
  const unlocated = stops.filter((s) => s.point === null || !located.includes(s as never));

  // Nearest neighbour.
  const left = [...located];
  const path: { id: string; point: Point }[] = [];
  let at = start;
  while (left.length) {
    let best = 0;
    let bestD = Infinity;
    left.forEach((s, i) => {
      const d = estimateRoadMeters(at, s.point, factorPct);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const [next] = left.splice(best, 1);
    path.push(next!);
    at = next!.point;
  }

  // 2-opt: reverse a stretch of the route if that makes the whole trip shorter.
  let improved = path.length > 2;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < path.length - 1; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const candidate = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
        if (tourMeters(start, candidate.map((s) => s.point), factorPct) < tourMeters(start, path.map((s) => s.point), factorPct)) {
          path.splice(0, path.length, ...candidate);
          improved = true;
        }
      }
    }
  }

  return {
    order: [...path.map((s) => s.id), ...unlocated.map((s) => s.id)],
    meters: tourMeters(start, path.map((s) => s.point), factorPct),
  };
}
