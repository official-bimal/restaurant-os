import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/server/db";
import { dayRange, localDate } from "@/lib/business-day";
import { stockStatus } from "@/features/stock/stock";
import { pushToTeam } from "./push";

/**
 * Alerts that are about something *still being true* rather than something that just happened, so they need a clock:
 * bills left open from an earlier day, and stock that is still low. Run it from any scheduler (a cron job, Render or
 * Vercel cron, a monitoring ping) by calling /api/cron/alerts with the CRON_SECRET. Each alert is sent at most once
 * per day per branch (or business), however often the check runs.
 */

/** Compares the secret the caller sent with the configured one without leaking where they differ. */
export function secretMatches(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || expected.length < 16 || !provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Records that an alert was sent today. Returns false if it already had been, so it is not repeated. */
async function firstTime(businessId: string, key: string): Promise<boolean> {
  // "Insert unless it is already there" in one statement: safe when two checks run at the same moment, and an
  // already-logged alert is simply a count of 0 rather than an error.
  const r = await db.pushLog.createMany({ data: [{ businessId, key }], skipDuplicates: true });
  return r.count === 1;
}

export async function runScheduledAlerts(now = new Date()) {
  const result = { businesses: 0, staleBillAlerts: 0, lowStockAlerts: 0 };
  const businesses = await db.business.findMany({ select: { id: true, timezone: true } });

  for (const b of businesses) {
    result.businesses += 1;
    const today = localDate(now, b.timezone);
    const { start } = dayRange(today, b.timezone);

    // Bills still open from before today, per branch, to the people who can pay or cancel them.
    const stale = await db.order.groupBy({
      by: ["branchId"],
      where: { businessId: b.id, status: { in: ["OPEN", "SERVED"] }, createdAt: { lt: start } },
      _count: { _all: true },
    });
    for (const row of stale) {
      if (!(await firstTime(b.id, `stale:${row.branchId}:${today}`))) continue;
      const n = row._count._all;
      const sent = await pushToTeam({
        businessId: b.id,
        branchId: row.branchId,
        permission: "order.edit",
        payload: {
          title: `${n} bill${n === 1 ? " is" : "s are"} still open from an earlier day`,
          body: "Pay or cancel them so the day can be closed.",
          url: "/notifications",
          tag: `stale-${row.branchId}`,
        },
      });
      if (sent > 0) result.staleBillAlerts += 1;
    }

    // Stock that is still low, branch by branch: one reminder a day per branch, not one per sale, to the people there.
    const levels = await db.branchStock.findMany({
      where: { businessId: b.id, active: true, stockItem: { active: true }, branch: { active: true } },
      select: { branchId: true, quantity: true, reorderLevel: true, stockItem: { select: { name: true } } },
    });
    const lowByBranch = new Map<string, string[]>();
    for (const l of levels) {
      if (stockStatus(l.quantity, l.reorderLevel) === "OK") continue;
      lowByBranch.set(l.branchId, [...(lowByBranch.get(l.branchId) ?? []), l.stockItem.name]);
    }
    for (const [branchId, names] of lowByBranch) {
      if (!(await firstTime(b.id, `lowstock:${branchId}:${today}`))) continue;
      const sent = await pushToTeam({
        businessId: b.id,
        branchId,
        permission: "stock.view",
        payload: {
          title: `${names.length} stock item${names.length === 1 ? " is" : "s are"} low`,
          body: names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", "),
          url: "/stock",
          tag: `low-stock-daily-${branchId}`,
        },
      });
      if (sent > 0) result.lowStockAlerts += 1;
    }
  }

  // The log only needs to remember today; keep two weeks so a late clock never repeats an alert.
  await db.pushLog.deleteMany({ where: { sentAt: { lt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) } } });
  return result;
}
