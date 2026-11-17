/**
 * Order and item status model. Pure functions, no I/O.
 *
 * Principle: an order has no status of its own while open. It is derived from
 * its items, so the two can never disagree (RestroX lets them drift apart).
 */

export const ITEM_STATUSES = [
  "PENDING", // on the ticket, not started
  "PREPARING",
  "READY",
  "SERVED",
  "CANCELLED",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ORDER_STATUSES = [
  "OPEN", // has at least one active item that is not served
  "SERVED", // all active items served, bill not yet settled
  "PAID",
  "CANCELLED",
  "MERGED", // folded into another order
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Allowed item transitions. Cancelling is allowed from any non-served state. */
const ITEM_TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  PENDING: ["PREPARING", "READY", "CANCELLED"],
  PREPARING: ["READY", "PENDING", "CANCELLED"],
  READY: ["SERVED", "PREPARING", "CANCELLED"],
  SERVED: [],
  CANCELLED: [],
};

export function canTransitionItem(from: ItemStatus, to: ItemStatus): boolean {
  return ITEM_TRANSITIONS[from].includes(to);
}

export function nextItemStatuses(from: ItemStatus): readonly ItemStatus[] {
  return ITEM_TRANSITIONS[from];
}

/**
 * Derive the status of an order that has not been paid or cancelled as a whole.
 * `settled` and `cancelled` come from the bill / explicit order cancellation.
 */
export function deriveOrderStatus(
  items: readonly { status: ItemStatus }[],
  flags: { settled: boolean; cancelled: boolean; merged?: boolean },
): OrderStatus {
  if (flags.merged) return "MERGED";
  if (flags.cancelled) return "CANCELLED";
  if (flags.settled) return "PAID";
  const active = items.filter((i) => i.status !== "CANCELLED");
  if (active.length === 0) return "OPEN";
  return active.every((i) => i.status === "SERVED") ? "SERVED" : "OPEN";
}

/** The kitchen cares about items that still need work. */
export function isKitchenActive(status: ItemStatus): boolean {
  return status === "PENDING" || status === "PREPARING";
}

/**
 * Ticket age colour for the kitchen display. `targetMinutes` is the item's
 * preparation target; the ticket turns amber at 75% and red once overdue.
 */
export type TicketAge = "FRESH" | "WARNING" | "LATE";

export function ticketAge(ageMinutes: number, targetMinutes: number): TicketAge {
  if (ageMinutes >= targetMinutes) return "LATE";
  if (ageMinutes >= targetMinutes * 0.75) return "WARNING";
  return "FRESH";
}
