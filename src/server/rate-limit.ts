/**
 * A small in-memory rate limiter for public pages (nobody is signed in, so the caller's address is all there is). One process only: with
 * several server processes each keeps its own count, which only makes the limit more generous, never stricter. It is a brake on abuse,
 * not a security boundary: the real protections are the per-phone and per-branch caps on waiting orders.
 */

const g = globalThis as unknown as { __rosLimits?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__rosLimits ??= new Map<string, number[]>());

/** Returns true if this call is allowed, and counts it. At most `limit` calls per `windowMs` for each key. */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000) {
    // Forget the oldest keys rather than grow without limit.
    for (const k of hits.keys()) {
      hits.delete(k);
      if (hits.size <= 4_000) break;
    }
  }
  return true;
}

/** For tests. */
export function resetLimits(): void {
  hits.clear();
}
