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
