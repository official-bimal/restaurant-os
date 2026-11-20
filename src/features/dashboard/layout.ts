import { DomainError } from "@/server/errors";

/**
 * Pure: how a dashboard layout is stored, checked and turned into what is shown. A layout is an ordered list of widgets, each with a size,
 * plus the ones the person hid, kept separately for desktop and mobile. Anything the saved layout does not know about is handled here, so
 * removed widgets disappear and new widgets appear without anyone editing their layout.
 */

export const SIZES = ["S", "M", "L"] as const;
export type Size = (typeof SIZES)[number];
export const TEMPLATES = ["CLASSIC", "MODERN", "COMPACT"] as const;
export type Template = (typeof TEMPLATES)[number];
export const DEVICES = ["desktop", "mobile"] as const;
export type Device = (typeof DEVICES)[number];

/** Columns of the grid on each device, and how many each size takes. */
export const COLUMNS: Record<Device, number> = { desktop: 4, mobile: 2 };
export const SPAN: Record<Device, Record<Size, number>> = {
  desktop: { S: 1, M: 2, L: 4 },
  mobile: { S: 1, M: 2, L: 2 },
};

export interface Placed {
  id: string;
  size: Size;
}
export interface DeviceLayout {
  order: Placed[];
  hidden: string[];
}
export interface DashboardConfig {
  v: 1;
  desktop: DeviceLayout;
  mobile: DeviceLayout;
}

/** What the layout engine needs to know about a widget (the full widget definition lives in registry.ts). */
export interface WidgetInfo {
  id: string;
  sizes: readonly Size[];
  defaultSize: Size;
}

export function cleanTemplate(v: unknown): Template {
  return (TEMPLATES as readonly string[]).includes(v as string) ? (v as Template) : "CLASSIC";
}

const isSize = (v: unknown): v is Size => (SIZES as readonly unknown[]).includes(v);

/**
 * Check a layout that came from a browser or from the database. Unknown widgets are dropped, repeats removed and sizes the widget does
 * not offer are put back to its default. Throws only when the shape is not a layout at all.
 */
export function parseConfig(raw: unknown, known: readonly WidgetInfo[]): DashboardConfig {
  if (!raw || typeof raw !== "object") throw new DomainError("That dashboard layout is not valid.");
  const byId = new Map(known.map((w) => [w.id, w]));
  const one = (d: unknown): DeviceLayout => {
    if (!d || typeof d !== "object") throw new DomainError("That dashboard layout is not valid.");
    const { order, hidden } = d as { order?: unknown; hidden?: unknown };
    if (!Array.isArray(order) || !Array.isArray(hidden)) throw new DomainError("That dashboard layout is not valid.");
    if (order.length > 100 || hidden.length > 100) throw new DomainError("That dashboard layout is too large.");
    const seen = new Set<string>();
    const placed: Placed[] = [];
    for (const p of order) {
      const id = p && typeof p === "object" ? (p as { id?: unknown }).id : undefined;
      const w = typeof id === "string" ? byId.get(id) : undefined;
      if (!w || seen.has(w.id)) continue;
      seen.add(w.id);
      const size = (p as { size?: unknown }).size;
      placed.push({ id: w.id, size: isSize(size) && w.sizes.includes(size) ? size : w.defaultSize });
    }
    const hide = [...new Set(hidden.filter((h): h is string => typeof h === "string" && byId.has(h)))];
    return { order: placed, hidden: hide };
  };
  const r = raw as { desktop?: unknown; mobile?: unknown };
  return { v: 1, desktop: one(r.desktop), mobile: one(r.mobile) };
}

/** The standard layout: every available widget in the template's order, at its default size. Mobile follows desktop order. */
export function defaultLayout(available: readonly WidgetInfo[], templateOrder: readonly string[]): DeviceLayout {
  const rank = (id: string) => {
    const i = templateOrder.indexOf(id);
    return i === -1 ? templateOrder.length : i;
  };
  const sorted = available.map((w, i) => ({ w, i })).sort((a, b) => rank(a.w.id) - rank(b.w.id) || a.i - b.i).map((x) => x.w);
  return { order: sorted.map((w) => ({ id: w.id, size: w.defaultSize })), hidden: [] };
}

export interface ResolvedLayout {
  /** In display order. */
  visible: Placed[];
  /** Available widgets the person has hidden (so the editor can offer to show them). */
  hidden: Placed[];
}

/**
 * What to show for one device: the saved order restricted to widgets that are available to this person now, then any available widget
 * the layout has never seen (a newly added one) after them in template order. With nothing saved it is the standard layout.
 */
export function resolveLayout(saved: DeviceLayout | null, available: readonly WidgetInfo[], templateOrder: readonly string[]): ResolvedLayout {
  const base = defaultLayout(available, templateOrder);
  if (!saved) return { visible: base.order, hidden: [] };
  const byId = new Map(available.map((w) => [w.id, w]));
  const hiddenSet = new Set(saved.hidden);
  const known = new Set<string>();
  const visible: Placed[] = [];
  const hidden: Placed[] = [];
  for (const p of saved.order) {
    const w = byId.get(p.id);
    known.add(p.id);
    if (!w) continue; // removed, or not allowed for this person now
    const size = w.sizes.includes(p.size) ? p.size : w.defaultSize;
    (hiddenSet.has(p.id) ? hidden : visible).push({ id: p.id, size });
  }
  for (const id of saved.hidden) {
    const w = byId.get(id);
    if (w && !known.has(id)) {
      known.add(id);
      hidden.push({ id, size: w.defaultSize });
    }
  }
  // New widgets since the layout was saved: shown, in the template's order, after what the person arranged.
  for (const p of base.order) if (!known.has(p.id)) visible.push(p);
  return { visible, hidden };
}

/** Turn what the editor holds (visible in order, hidden) back into a saved layout. */
export function toDeviceLayout(visible: Placed[], hidden: Placed[]): DeviceLayout {
  return { order: [...visible, ...hidden], hidden: hidden.map((h) => h.id) };
}

/** Move one item to a new index (drag and drop, or a button), returning a new array. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const t = Math.min(Math.max(to, 0), list.length - 1);
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(t, 0, x!);
  return next;
}

/** Which row of a device's grid each visible widget starts in (used by the preview and by up/down moves). */
export function rowsOf(visible: readonly Placed[], device: Device): number[] {
  const cols = COLUMNS[device];
  let used = 0;
  let row = 0;
  return visible.map((p) => {
    const span = SPAN[device][p.size];
    if (used + span > cols) {
      row++;
      used = 0;
    }
    used += span;
    return row;
  });
}

/** Index to move to for "up" or "down": the first widget of the previous or next row. */
export function verticalTarget(visible: readonly Placed[], device: Device, index: number, dir: "up" | "down"): number {
  const rows = rowsOf(visible, device);
  const here = rows[index] ?? 0;
  if (dir === "up") {
    if (here === 0) return index;
    const first = rows.indexOf(here - 1);
    return first < 0 ? index : first;
  }
  const next = rows.lastIndexOf(here + 1);
  return next < 0 ? index : Math.min(next, visible.length - 1);
}
