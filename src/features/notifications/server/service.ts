import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { dayRange, localDate } from "@/lib/business-day";
import { stockStatus } from "@/features/stock/stock";
import { LOW_RATING_MAX } from "@/features/feedback/rating";

/**
 * One list of everything that needs someone's attention right now, built from what already
 * exists (guest orders and requests, stock, ratings, bills left open). Nothing is stored:
 * a notification disappears when the thing it is about is dealt with. Only items the
 * person's role can act on are included, and only for their current branch.
 */

export type NotificationKind = "CLOCK" | "GUEST_ORDER" | "GUEST_REQUEST" | "LOW_STOCK" | "LOW_RATING" | "STALE_BILL" | "STOCK_ARRIVING";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  /** "alert" needs action soon; "warn" is worth a look; "info" is routine. */
  level: "alert" | "warn" | "info";
  title: string;
  detail: string;
  href: string;
  at: Date;
  /** This team member has marked it as read. It stays on the list until it is dealt with. */
  read: boolean;
}

const REQUEST_TEXT = { CALL_WAITER: "is calling a waiter", REQUEST_BILL: "asked for the bill", WATER: "asked for water" } as const;

export async function listNotifications(ctx: TenantContext): Promise<AppNotification[]> {
  const out: Omit<AppNotification, "read">[] = [];
  const { businessId, branchId } = scope(ctx);

  // Who clocked in or out lately (owner and managers), so it shows with the other alerts for the next half day.
  if (can(ctx, "time.manage")) {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const [ins, outs] = await Promise.all([
      db.timeEntry.findMany({ where: { businessId, branchId, source: "CLOCK", clockIn: { gte: since } }, include: { user: { select: { name: true } } }, orderBy: { clockIn: "desc" }, take: 20 }),
      db.timeEntry.findMany({ where: { businessId, branchId, source: "CLOCK", clockOut: { gte: since } }, include: { user: { select: { name: true } } }, orderBy: { clockOut: "desc" }, take: 20 }),
    ]);
    for (const e of ins) out.push({ id: `clk-in-${e.id}`, kind: "CLOCK", level: "info", title: `${e.user.name} clocked in`, detail: e.inDistanceM !== null ? `${e.inDistanceM} m from the cafe` : "Tap to see today's attendance", href: "/attendance", at: e.clockIn });
    for (const e of outs) out.push({ id: `clk-out-${e.id}`, kind: "CLOCK", level: e.outAway ? "warn" : "info", title: `${e.user.name} clocked out`, detail: e.outAway ? `Clocked out ${e.outDistanceM} m away from the cafe` : "Tap to see today's attendance", href: "/attendance", at: e.clockOut! });
  }

  if (can(ctx, "order.edit")) {
    const [subs, reqs] = await Promise.all([
      db.guestSubmission.findMany({
        where: { businessId, status: "PENDING", table: { branchId } },
        include: { table: { select: { label: true } }, items: { select: { quantity: true } } },
        orderBy: { createdAt: "asc" },
      }),
      db.serviceRequest.findMany({
        where: { businessId, status: "OPEN", table: { branchId } },
        include: { table: { select: { label: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    for (const s of subs) {
      out.push({
        id: `sub-${s.id}`,
        kind: "GUEST_ORDER",
        level: "alert",
        title: `Table ${s.table.label} sent an order`,
        detail: `${s.items.reduce((n, i) => n + i.quantity, 0)} items waiting for you to accept`,
        href: "/orders",
        at: s.createdAt,
      });
    }
    for (const r of reqs) {
      out.push({
        id: `req-${r.id}`,
        kind: "GUEST_REQUEST",
        level: r.kind === "REQUEST_BILL" ? "alert" : "warn",
        title: `Table ${r.table.label} ${REQUEST_TEXT[r.kind]}`,
        detail: "Tap to open orders and mark it done",
        href: "/orders",
        at: r.createdAt,
      });
    }

    // Bills still open from before today: they will block closing the day.
    const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
    const { start } = dayRange(localDate(new Date(), business.timezone), business.timezone);
    const stale = await db.order.findMany({
      where: { businessId, branchId, status: { in: ["OPEN", "SERVED"] }, createdAt: { lt: start } },
      include: { table: { select: { label: true } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    for (const o of stale) {
      out.push({
        id: `stale-${o.id}`,
        kind: "STALE_BILL",
        level: "warn",
        title: `Order #${o.number} is still open from an earlier day`,
        detail: `${o.table ? `Table ${o.table.label}` : "Takeaway"} · pay or cancel it so the day can be closed`,
        href: `/orders/${o.id}`,
        at: o.createdAt,
      });
    }
  }

  if (can(ctx, "stock.view")) {
    const levels = await db.branchStock.findMany({
      where: { businessId, branchId, active: true, stockItem: { active: true } },
      include: { stockItem: true },
      orderBy: { stockItem: { name: "asc" } },
    });
    for (const l of levels) {
      const i = { ...l.stockItem, quantity: l.quantity, reorderLevel: l.reorderLevel };
      const status = stockStatus(i.quantity, i.reorderLevel);
      if (status === "OK") continue;
      out.push({
        id: `stock-${branchId}-${i.id}`,
        kind: "LOW_STOCK",
        level: status === "LOW" ? "warn" : "alert",
        title:
          status === "LOW"
            ? `${i.name} is running low`
            : status === "OUT"
              ? `${i.name} is out of stock`
              : `${i.name} has gone below zero: check the count`,
        detail: `${i.quantity.toLocaleString("en-US")} ${i.unit} left (reorder at ${i.reorderLevel.toLocaleString("en-US")})`,
        href: "/stock",
        at: i.createdAt,
      });
    }
  }

  // Stock sent to this branch that has not been booked in yet.
  if (can(ctx, "stock.manage")) {
    const incoming = await db.stockTransfer.findMany({
      where: { businessId, toBranchId: branchId, status: "IN_TRANSIT" },
      include: { stockItem: { select: { name: true, unit: true } }, from: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    for (const t of incoming) {
      out.push({
        id: `transfer-${t.id}`,
        kind: "STOCK_ARRIVING",
        level: "warn",
        title: `${t.quantity.toLocaleString("en-US")} ${t.stockItem.unit} of ${t.stockItem.name} is on its way from ${t.from.name}`,
        detail: "Book it in when it arrives, counting what actually came",
        href: "/stock/branches",
        at: t.createdAt,
      });
    }
  }

  if (can(ctx, "feedback.view")) {
    const low = await db.feedback.findMany({
      where: { businessId, rating: { lte: LOW_RATING_MAX }, handledAt: null },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    for (const f of low) {
      out.push({
        id: `fb-${f.id}`,
        kind: "LOW_RATING",
        level: "alert",
        title: `A guest gave ${f.rating} star${f.rating === 1 ? "" : "s"}`,
        detail: f.comment ? `“${f.comment.slice(0, 120)}”` : "No comment left. Look into it and note what you did.",
        href: "/feedback",
        at: f.createdAt,
      });
    }
  }

  // Read state is per person: what one cashier has seen does not hide it from the manager.
  const reads = await db.notificationRead.findMany({
    where: { userId: ctx.userId, businessId, key: { in: out.map((o) => o.id) } },
    select: { key: true },
  });
  const readKeys = new Set(reads.map((r) => r.key));
  const rank = { alert: 0, warn: 1, info: 2 } as const;
  return out
    .map((o) => ({ ...o, read: readKeys.has(o.id) }))
    .sort((a, b) => Number(a.read) - Number(b.read) || rank[a.level] - rank[b.level] || a.at.getTime() - b.at.getTime());
}

/** Mark some notifications as read for this person. Only keys of notifications they can currently see are stored. */
export async function markRead(ctx: TenantContext, keys: string[]) {
  const visible = new Set((await listNotifications(ctx)).map((n) => n.id));
  const wanted = [...new Set(keys)].filter((k) => visible.has(k));
  if (wanted.length === 0) return;
  await db.notificationRead.createMany({
    data: wanted.map((key) => ({ userId: ctx.userId, businessId: ctx.businessId, key })),
    skipDuplicates: true,
  });
  // Housekeeping: a read mark only matters while its notification exists, so old ones can go.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db.notificationRead.deleteMany({ where: { userId: ctx.userId, readAt: { lt: cutoff } } });
}

export async function markAllRead(ctx: TenantContext) {
  await markRead(ctx, (await listNotifications(ctx)).map((n) => n.id));
}
