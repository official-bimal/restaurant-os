/**
 * Live updates. When something changes (an order, a ticket, a request), the server tells every open staff page of that
 * business and branch, and the page re-fetches itself. Only a topic name travels; the page reads its data the normal,
 * permission-checked way, so nothing private is ever put on the stream.
 *
 * This is an in-memory channel inside one server process. That is right for a single app server (the shop's own
 * computer, or one container). With several server processes behind a load balancer an event only reaches the pages
 * connected to the process that handled the change; the pages' slow background refresh covers the rest, so nothing breaks,
 * updates just are not instant for everyone. A shared channel (Redis, Postgres LISTEN/NOTIFY) would remove that limit.
 */

export interface LiveEvent {
  businessId: string;
  /** Leave out for "every branch of the business". */
  branchId?: string | null;
  topic: string;
}

type Listener = (e: LiveEvent) => void;

interface Bus {
  listeners: Set<Listener>;
  /** Open streams per person, so one account cannot hold hundreds of connections. */
  perUser: Map<string, Set<() => void>>;
}

// One bus for the whole process, even when the bundler gives route handlers and server actions their own copy of this file.
const g = globalThis as unknown as { __rosLive?: Bus };
const bus: Bus = (g.__rosLive ??= { listeners: new Set(), perUser: new Map() });

export const MAX_STREAMS_PER_USER = 6;

export function publishLive(e: LiveEvent): void {
  for (const l of bus.listeners) {
    try {
      l(e);
    } catch {
      /* one broken listener must not stop the others */
    }
  }
}

/** Tell the pages about a change a moment from now, so the change is committed by the time they re-read. */
export function publishLiveSoon(e: LiveEvent, delayMs = 120): void {
  setTimeout(() => publishLive(e), delayMs).unref?.();
}

export function subscribeLive(listener: Listener): () => void {
  bus.listeners.add(listener);
  return () => bus.listeners.delete(listener);
}

/**
 * Register an open stream for a person. If they already have the maximum, the oldest is closed first.
 * Returns a function to call when the stream ends.
 */
export function registerStream(userId: string, close: () => void): () => void {
  const set = bus.perUser.get(userId) ?? new Set<() => void>();
  bus.perUser.set(userId, set);
  while (set.size >= MAX_STREAMS_PER_USER) {
    const oldest = set.values().next().value as (() => void) | undefined;
    if (!oldest) break;
    set.delete(oldest);
    try {
      oldest();
    } catch {
      /* already closed */
    }
  }
  set.add(close);
  return () => {
    set.delete(close);
    if (set.size === 0) bus.perUser.delete(userId);
  };
}

export function listenerCount(): number {
  return bus.listeners.size;
}
