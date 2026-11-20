import { DomainError } from "@/server/errors";

/**
 * Pure: which printer a slip goes to. A branch has routes: for each kind of slip a default printer, and for kitchen slips optionally a
 * printer per station (a Bar printer and a Grill printer). With no routes everything goes to "any printer program that does not name a
 * printer", which is how a single printer has always worked.
 */

export const ROUTE_KINDS = ["KITCHEN", "RECEIPT", "CREDIT_NOTE"] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

export const KIND_LABEL: Record<string, string> = { KITCHEN: "Kitchen slips", RECEIPT: "Bills", CREDIT_NOTE: "Credit notes", TEST: "Test page" };

export interface RouteRow {
  kind: string;
  /** A station id for a kitchen route, or "" for the kind's default. */
  stationKey: string;
  printerId: string;
}

/** The key used for dishes that have no station. */
export const NO_STATION = "";

/** The printer for a bill or credit note: the default route of that kind, or none (any printer program). */
export function printerForKind(routes: readonly RouteRow[], kind: string): string | null {
  return routes.find((r) => r.kind === kind && r.stationKey === NO_STATION)?.printerId ?? null;
}

export interface Target {
  /** null: a printer program that names no printer. */
  printerId: string | null;
  /** The stations this job covers. Empty means all of them. */
  keys: string[];
}

/**
 * Share the stations of an order's unprinted items between printers. A station with its own route goes there; the rest go to the kitchen
 * default; stations with neither go to the unnamed printer. With no kitchen routes at all there is one target that takes everything.
 */
export function splitKitchen(routes: readonly RouteRow[], stationKeys: readonly string[]): Target[] {
  const kitchen = routes.filter((r) => r.kind === "KITCHEN");
  if (kitchen.length === 0) return [{ printerId: null, keys: [] }];
  const fallback = kitchen.find((r) => r.stationKey === NO_STATION)?.printerId ?? null;
  const groups = new Map<string | null, string[]>();
  for (const key of [...new Set(stationKeys)]) {
    const own = key === NO_STATION ? undefined : kitchen.find((r) => r.stationKey === key)?.printerId;
    const to = own ?? fallback;
    groups.set(to, [...(groups.get(to) ?? []), key]);
  }
  return [...groups].map(([printerId, keys]) => ({ printerId, keys }));
}

export interface RouteInput {
  kind: string;
  stationKey: string;
  /** Empty or null removes the route. */
  printerId: string | null;
}

/** Check the posted routes against what exists. Returns only the routes to keep. */
export function cleanRoutes(input: readonly RouteInput[], validPrinters: ReadonlySet<string>, validStations: ReadonlySet<string>): RouteRow[] {
  const out = new Map<string, RouteRow>();
  for (const r of input) {
    if (!(ROUTE_KINDS as readonly string[]).includes(r.kind)) throw new DomainError("That kind of slip is not known.");
    if (!r.printerId) continue;
    if (!validPrinters.has(r.printerId)) throw new DomainError("Choose one of this branch's printers.");
    if (r.stationKey !== NO_STATION) {
      if (r.kind !== "KITCHEN") throw new DomainError("Only kitchen slips can be sent by station.");
      if (!validStations.has(r.stationKey)) throw new DomainError("That station does not exist.");
    }
    out.set(`${r.kind}|${r.stationKey}`, { kind: r.kind, stationKey: r.stationKey, printerId: r.printerId });
  }
  return [...out.values()];
}

/** A printer's name, tidied: 1 to 40 characters. */
export function cleanPrinterName(v: string): string {
  const n = v.trim().replace(/\s+/g, " ");
  if (n.length < 1 || n.length > 40) throw new DomainError("Give the printer a name of 1 to 40 characters.");
  return n;
}

/** A printer's own paper width in mm, or null to use the business setting. */
export function cleanPrinterWidth(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 40 || n > 300) throw new DomainError("Paper width must be 40 to 300 mm, or empty to use the business setting.");
  return n;
}

/** How long since a printer program last asked, in words, for the screen. */
export function seenText(lastSeen: Date | null, now: Date): { text: string; online: boolean } {
  if (!lastSeen) return { text: "No printer program has connected yet", online: false };
  const s = Math.max(0, Math.round((now.getTime() - lastSeen.getTime()) / 1000));
  const online = s <= 30;
  if (s < 60) return { text: online ? "Connected" : `Last seen ${s} seconds ago`, online };
  const m = Math.round(s / 60);
  if (m < 60) return { text: `Last seen ${m} minute${m === 1 ? "" : "s"} ago`, online: false };
  const h = Math.round(m / 60);
  if (h < 48) return { text: `Last seen ${h} hour${h === 1 ? "" : "s"} ago`, online: false };
  return { text: `Last seen ${Math.round(h / 24)} days ago`, online: false };
}
