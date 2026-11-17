/**
 * Sign-in rate limiting policy. Pure functions, no I/O.
 *
 * Three counters stop three different attacks:
 *  - pair:  one email from one network. Stops guessing one account's password. Tight.
 *  - ip:    one network across all emails. Stops password spraying. Applied only when the
 *           client IP is known and trusted.
 *  - email: one account from anywhere. Caps a distributed attack on one account. Loose, so
 *           a stranger cannot lock the real owner out with a handful of requests.
 */
export interface Rule {
  scope: "pair" | "ip" | "email" | "pw";
  max: number;
  windowMs: number;
}

const MIN = 60_000;

export const LOGIN_RULES = {
  pair: { scope: "pair", max: 5, windowMs: 15 * MIN },
  ip: { scope: "ip", max: 30, windowMs: 15 * MIN },
  email: { scope: "email", max: 50, windowMs: 60 * MIN },
} as const satisfies Record<string, Rule>;

/** Checking the current password while changing it (stolen-session protection). */
export const PASSWORD_CHECK_RULE: Rule = { scope: "pw", max: 5, windowMs: 15 * MIN };

/**
 * How many seconds until the caller may try again, or 0 if they may now.
 * `attempts` are the timestamps (ms) of counted attempts inside the window, any order.
 * The caller is blocked while `max` or more attempts are inside the window; the earliest
 * moment they are free again is when enough old attempts have aged out.
 */
export function retryAfterSeconds(attempts: number[], rule: Pick<Rule, "max" | "windowMs">, now: number): number {
  const live = attempts.filter((t) => t > now - rule.windowMs).sort((a, b) => a - b);
  if (live.length < rule.max) return 0;
  // Attempt number (live.length - max) must expire for the count to drop below max.
  const blocker = live[live.length - rule.max];
  return Math.max(1, Math.ceil((blocker + rule.windowMs - now) / 1000));
}

export function formatWait(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "a minute" : `${minutes} minutes`;
}
