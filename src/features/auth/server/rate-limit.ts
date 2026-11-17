import { createHash } from "node:crypto";
import { db } from "@/server/db";
import {
  LOGIN_RULES,
  PASSWORD_CHECK_RULE,
  retryAfterSeconds,
  type Rule,
} from "@/features/auth/rate-limit-policy";

/**
 * Sign-in rate limiting, stored in the database so it survives restarts and works across
 * several app instances.
 *
 * Each attempt is RECORDED FIRST, then counted. Counting first and recording after leaves
 * a gap where a burst of parallel guesses all pass the check. A blocked attempt removes
 * its own record, so an attacker who keeps hammering does not extend their own lockout
 * (and the real owner is free as soon as the window ages out). A successful sign-in
 * releases its record and clears earlier failures for that email and network.
 */

export type Guard =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; retryAfterSeconds: number };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

interface Check {
  rule: Rule;
  key: string;
}

async function consume(checks: Check[], clearOnSuccess: Check[] = []): Promise<Guard> {
  const now = Date.now();
  const inserted: string[] = [];
  let wait = 0;

  for (const { rule, key } of checks) {
    const row = await db.loginAttempt.create({ data: { scope: rule.scope, key } });
    inserted.push(row.id);
    const rows = await db.loginAttempt.findMany({
      where: { scope: rule.scope, key, createdAt: { gt: new Date(now - rule.windowMs) } },
      select: { createdAt: true },
    });
    // The attempt we just recorded is in `rows`. Allowed attempts per window = rule.max,
    // so this one is blocked when it is number max + 1.
    const retry = retryAfterSeconds(
      rows.map((r) => r.createdAt.getTime()),
      { max: rule.max + 1, windowMs: rule.windowMs },
      now,
    );
    if (retry > 0) {
      wait = retry;
      break;
    }
  }

  if (wait > 0) {
    await db.loginAttempt.deleteMany({ where: { id: { in: inserted } } });
    return { ok: false, retryAfterSeconds: wait };
  }

  // Housekeeping: nothing older than the longest window matters.
  if (Math.random() < 0.05) {
    await db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now - 2 * 60 * 60 * 1000) } } });
  }

  return {
    ok: true,
    release: async () => {
      await db.loginAttempt.deleteMany({
        where: {
          OR: [
            { id: { in: inserted } },
            ...clearOnSuccess.map((c) => ({ scope: c.rule.scope, key: c.key })),
          ],
        },
      });
    },
  };
}

/**
 * Start a sign-in attempt. Counts against the account+network pair, the network (when its
 * IP is known and trusted) and the account overall. The email is counted whether or not
 * the account exists, so the answer never reveals which emails are registered.
 */
export function beginLogin(email: string, ip: string | null): Promise<Guard> {
  const e = email.trim().toLowerCase();
  const pair: Check = { rule: LOGIN_RULES.pair, key: sha(`pair|${e}|${ip ?? "unknown"}`) };
  const checks: Check[] = [pair];
  if (ip) checks.push({ rule: LOGIN_RULES.ip, key: sha(`ip|${ip}`) });
  checks.push({ rule: LOGIN_RULES.email, key: sha(`email|${e}`) });
  return consume(checks, [pair]);
}

/** Guards the "current password" check when changing a password. */
export function beginPasswordCheck(userId: string): Promise<Guard> {
  const check: Check = { rule: PASSWORD_CHECK_RULE, key: sha(`pw|${userId}`) };
  return consume([check], [check]);
}
