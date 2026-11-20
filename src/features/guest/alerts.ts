/**
 * What the floor staff are told when a guest asks for something at the table. Pure functions, no I/O.
 */

export type RequestKind = "CALL_WAITER" | "REQUEST_BILL" | "WATER";

/** After this many minutes a request counts as late: it turns red and sounds again. */
export const LATE_AFTER_MINUTES: Record<RequestKind, number> = { REQUEST_BILL: 2, CALL_WAITER: 2, WATER: 5 };

/** Water is shown in the list but never rings the bell by itself. */
export function rings(kind: RequestKind): boolean {
  return kind !== "WATER";
}

export function waitedMinutes(since: Date | number, now: Date | number): number {
  const a = typeof since === "number" ? since : since.getTime();
  const b = typeof now === "number" ? now : now.getTime();
  return Math.max(0, Math.floor((b - a) / 60_000));
}

export function isLate(kind: RequestKind, since: Date | number, now: Date | number): boolean {
  return waitedMinutes(since, now) >= LATE_AFTER_MINUTES[kind];
}

const WHAT: Record<RequestKind, string> = { REQUEST_BILL: "wants the bill", CALL_WAITER: "is calling the waiter", WATER: "wants water" };
const FOR: Record<RequestKind, string> = { REQUEST_BILL: "the bill", CALL_WAITER: "the waiter", WATER: "water" };

export function requestTitle(kind: RequestKind, tableLabel: string): string {
  return `Table ${tableLabel} ${WHAT[kind]}`;
}

export function lateTitle(kind: RequestKind, tableLabel: string, minutes: number): string {
  return `Table ${tableLabel} has waited ${minutes} min for ${FOR[kind]}`;
}

export function waitedText(minutes: number): string {
  return minutes === 0 ? "just now" : `${minutes} min`;
}

const ORDER: Record<RequestKind, number> = { REQUEST_BILL: 0, CALL_WAITER: 1, WATER: 2 };

/** The bill first, then the waiter, then water; the one that has waited longest first. */
export function sortRequests<T extends { kind: RequestKind; createdAt: Date | number }>(list: T[]): T[] {
  const t = (x: Date | number) => (typeof x === "number" ? x : x.getTime());
  return list.slice().sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || t(a.createdAt) - t(b.createdAt));
}

/**
 * What the chime and the pop-up should announce: one entry per request that rings, and a second one (with a different id) once it has
 * waited too long, so a request that is being ignored sounds again. The watcher only sounds for ids it has not seen.
 */
export function ringAlerts(requests: { id: string; kind: RequestKind; tableLabel: string; createdAt: Date | number }[], now: Date | number): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  for (const r of sortRequests(requests)) {
    if (!rings(r.kind)) continue;
    out.push({ id: `req-${r.id}`, title: requestTitle(r.kind, r.tableLabel) });
    if (isLate(r.kind, r.createdAt, now)) out.push({ id: `req-${r.id}-late`, title: lateTitle(r.kind, r.tableLabel, waitedMinutes(r.createdAt, now)) });
  }
  return out;
}
