import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { getAttendance } from "@/features/payroll/server/time";
import { addDays, dayRange, localDate } from "@/lib/business-day";
import { listOpenOrders, listTables } from "@/features/orders/server/service";
import { getDayReport } from "@/features/reports/server/service";
import { getDashboardCharts } from "@/features/reports/server/charts";
import { inboxCount } from "@/features/guest/server/service";
import { unresolvedCount } from "@/features/feedback/server/service";
import { listStock, lowStockCount } from "@/features/stock/server/service";
import { onlineInboxCount } from "@/features/online/server/service";
import { reservationsWaitingCount } from "@/features/reservations/server/service";
import { hukkaAlertCount } from "@/features/hukka/server/service";
import { unseenAlertCount } from "@/features/owner/server/owner";
import { buildNav } from "@/features/nav/nav";

/**
 * Everything the dashboard widgets read, for the person and branch in ctx. Only what the shown widgets need is fetched, and every query is
 * filtered by the business and branch and by what the person may see, so a widget never shows what its viewer could not open.
 */

export async function loadDashboard(ctx: TenantContext, needed: ReadonlySet<string>) {
  const want = (...ids: string[]) => ids.some((i) => needed.has(i));
  const showMoney = can(ctx, "report.view");

  const [business, user, branch, orders, tables, guestWaiting, lowRatings, lowStock, onlineWaiting, reservationsWaiting, hukkaLong, hukkaCategories, ownerAlerts] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { name: true, timezone: true, multiBranch: true } }),
    db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } }),
    db.branch.findUniqueOrThrow({ where: { businessId_id: { businessId: ctx.businessId, id: ctx.branchId } }, select: { name: true } }),
    listOpenOrders(ctx),
    listTables(ctx),
    inboxCount(ctx),
    can(ctx, "feedback.view") ? unresolvedCount(ctx) : 0,
    can(ctx, "stock.view") ? lowStockCount(ctx) : 0,
    can(ctx, "order.edit") ? onlineInboxCount(ctx) : 0,
    reservationsWaitingCount(ctx),
    hukkaAlertCount(ctx),
    db.menuCategory.count({ where: { businessId: ctx.businessId, OR: [{ name: { contains: "hukka", mode: "insensitive" } }, { name: { contains: "shisha", mode: "insensitive" } }, { name: { contains: "hookah", mode: "insensitive" } }] } }),
    can(ctx, "owner.control") ? unseenAlertCount(ctx) : 0,
  ]);
  const tz = business.timezone;
  const today = localDate(new Date(), tz);

  const day = showMoney && want("salesToday", "billsPaid", "averageBill", "topSelling") ? await getDayReport(ctx) : null;
  const charts = showMoney && want("revenue7", "salesByHour", "paymentBreakdown", "weekCompare") ? await getDashboardCharts(ctx) : null;
  const attendance = can(ctx, "time.manage") && want("floor") ? await getAttendance(ctx, today) : null;

  const lowStockItems =
    can(ctx, "stock.view") && want("lowStockProducts")
      ? (await listStock(ctx))
          .filter((s) => s.status !== "OK")
          .slice(0, 6)
          .map((s) => ({ id: s.id, name: s.name, quantity: s.quantity, reorderLevel: s.reorderLevel, unit: s.unit, out: s.status === "OUT" || s.status === "NEGATIVE" }))
      : [];

  const recent =
    can(ctx, "bills.view") && want("recentTransactions")
      ? (
          await db.invoice.findMany({
            where: { businessId: ctx.businessId, branchId: ctx.branchId },
            orderBy: { createdAt: "desc" },
            take: 6,
            select: { id: true, number: true, grandTotal: true, createdAt: true, payments: { select: { method: true }, take: 1 } },
          })
        ).map((i) => ({ id: i.id, number: i.number, total: i.grandTotal, at: i.createdAt, method: i.payments[0]?.method ?? null }))
      : [];

  let customers: { total: number; newWeek: number; returning: number; withConsent: number } | null = null;
  if (can(ctx, "customer.manage") && want("customerOverview")) {
    const weekAgo = dayRange(addDays(today, -6), tz).start;
    const [total, newWeek, returning, withConsent] = await Promise.all([
      db.customer.count({ where: { businessId: ctx.businessId } }),
      db.customer.count({ where: { businessId: ctx.businessId, firstSeenAt: { gte: weekAgo } } }),
      db.customer.count({ where: { businessId: ctx.businessId, visitCount: { gte: 2 } } }),
      db.customer.count({ where: { businessId: ctx.businessId, marketingConsent: true, consentVerified: true } }),
    ]);
    customers = { total, newWeek, returning, withConsent };
  }

  const nav = buildNav({
    role: ctx.role,
    permissions: ctx.permissions,
    multiBranch: business.multiBranch,
    hukka: hukkaCategories > 0,
    counts: { guestWaiting, onlineWaiting, reservationsWaiting, hukkaLong, lowStock, lowRatings, ownerAlerts },
  });

  const occupied = new Set(orders.map((o) => o.tableId).filter(Boolean)).size;
  return {
    business,
    branchName: branch.name,
    firstName: user.name.split(/\s+/)[0] ?? user.name,
    orders,
    tables,
    occupied,
    occupancy: tables.length ? Math.round((occupied / tables.length) * 100) : 0,
    day,
    charts,
    attendance,
    lowStock,
    lowStockItems,
    recent,
    customers,
    sections: nav.sections,
    attention: [
      { n: onlineWaiting, text: "online orders waiting", href: "/online", urgent: true },
      { n: guestWaiting, text: "guest orders or requests waiting", href: "/orders", urgent: true },
      { n: hukkaLong, text: "hukkas running long", href: "/hukka", urgent: true },
      { n: reservationsWaiting, text: "table requests to answer", href: "/reservations", urgent: false },
      { n: ownerAlerts, text: "things to check", href: "/owner", urgent: true },
      { n: lowStock, text: "stock items running low", href: "/stock", urgent: false },
      { n: lowRatings, text: "low ratings to look into", href: "/feedback", urgent: false },
    ].filter((a) => a.n > 0),
  };
}

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;
