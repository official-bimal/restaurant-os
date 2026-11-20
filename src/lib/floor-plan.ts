/**
 * The floor plan of an area: where each table sits. Positions are thousandths of the plan's width and height (the table's centre), so the
 * plan looks the same on a phone and a computer. Pure functions, no I/O.
 */

export const PLAN_MIN = 60;
export const PLAN_MAX = 940;

export function clampPos(v: number): number {
  if (!Number.isFinite(v)) return 500;
  return Math.min(PLAN_MAX, Math.max(PLAN_MIN, Math.round(v)));
}

/** A tidy grid slot for the n-th of `count` tables, for tables that have not been placed yet. */
export function defaultPosition(index: number, count: number): { x: number; y: number } {
  const cols = Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count * 1.5))));
  const rows = Math.max(1, Math.ceil(count / cols));
  const col = index % cols;
  const row = Math.floor(index / cols);
  const x = ((col + 0.5) / cols) * (PLAN_MAX - PLAN_MIN) + PLAN_MIN;
  const y = ((row + 0.5) / rows) * (PLAN_MAX - PLAN_MIN) + PLAN_MIN;
  return { x: clampPos(x), y: clampPos(y) };
}

/**
 * A neat grid for `count` tables with `perRow` in each row, filled left to right then top to bottom, so tables in counting order read
 * 1 2 3 across. perRow 0 means "choose a sensible number".
 */
export function gridPositions(count: number, perRow: number): { x: number; y: number }[] {
  const cols = perRow >= 1 ? Math.min(Math.floor(perRow), Math.max(1, count)) : Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count * 1.5))));
  const rows = Math.max(1, Math.ceil(count / cols));
  return Array.from({ length: count }, (_, i) => ({
    x: clampPos(((i % cols) + 0.5) / cols * (PLAN_MAX - PLAN_MIN) + PLAN_MIN),
    y: clampPos((Math.floor(i / cols) + 0.5) / rows * (PLAN_MAX - PLAN_MIN) + PLAN_MIN),
  }));
}

/** Snap a position to the grid so tables line up; step 25 is a quarter of a tenth of the plan. */
export function snap(v: number, step = 25): number {
  return clampPos(Math.round(v / step) * step);
}

export interface Placed {
  id: string;
  posX: number | null;
  posY: number | null;
}

/** Where every table is drawn: its saved place, or a grid slot when it has none. */
export function resolvePlan<T extends Placed>(tables: T[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  tables.forEach((t, i) => out.set(t.id, t.posX !== null && t.posY !== null ? { x: clampPos(t.posX), y: clampPos(t.posY) } : defaultPosition(i, tables.length)));
  return out;
}

/** An area uses its plan once any table in it has been placed. */
export function hasPlan(tables: Placed[]): boolean {
  return tables.some((t) => t.posX !== null && t.posY !== null);
}

/** How wide a table is drawn on the plan, as a percentage of the plan's width: long tables are wider. */
export function planWidthPercent(capacity: number): number {
  return capacity > 6 ? 24 : 15;
}
