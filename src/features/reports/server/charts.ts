import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { addDays, dayRange, localDate } from "@/lib/business-day";
import { dayBuckets, hourBuckets, methodSlices, weekOverWeek, type MoneyEvent } from "../charts";

/**
 * The numbers behind the dashboard charts, for the branch the person works in: sales by hour today, how customers paid today, and the
 * last 7 days against the 7 before. Sales are bills paid less credit notes, at the time each was made. Owners and managers.
 */
export async function getDashboardCharts(ctx: TenantContext) {
  if (!can(ctx.role, "report.view")) throw new DomainError("You do not have permission to see reports.");
  const { businessId, branchId } = scope(ctx);
  const biz = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  const tz = biz.timezone;
  const now = new Date();
  const today = localDate(now, tz);
  const start = dayRange(addDays(today, -13), tz).start;
  const end = dayRange(today, tz).end;
  const todayStart = dayRange(today, tz).start;

  const [invoices, notes, payments] = await Promise.all([
    db.invoice.findMany({ where: { businessId, branchId, createdAt: { gte: start, lt: end } }, select: { grandTotal: true, createdAt: true } }),
    db.creditNote.findMany({ where: { businessId, invoice: { branchId }, createdAt: { gte: start, lt: end } }, select: { grandTotal: true, createdAt: true } }),
    db.payment.findMany({ where: { businessId, invoice: { branchId }, createdAt: { gte: todayStart, lt: end } }, select: { method: true, amount: true } }),
  ]);
  const events: MoneyEvent[] = [...invoices.map((i) => ({ at: i.createdAt, amount: i.grandTotal })), ...notes.map((n) => ({ at: n.createdAt, amount: -n.grandTotal }))];
  const daily = dayBuckets(events, tz, today, 14);
  return {
    today,
    byHour: hourBuckets(events, tz, today),
    methods: methodSlices(payments),
    methodsTotal: payments.reduce((n, p) => n + p.amount, 0),
    week: weekOverWeek(daily),
  };
}
