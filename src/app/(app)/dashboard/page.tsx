import { getAttendance } from "@/features/payroll/server/time";
import { localDate } from "@/lib/business-day";
import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { db } from "@/server/db";
import { formatNpr } from "@/features/billing/calc";
import { listOpenOrders, listTables } from "@/features/orders/server/service";
import { getDayReport } from "@/features/reports/server/service";
import { inboxCount } from "@/features/guest/server/service";
import { unresolvedCount } from "@/features/feedback/server/service";
import { lowStockCount } from "@/features/stock/server/service";
import { AutoRefresh } from "@/components/auto-refresh";
import { Icon } from "@/components/icons";
import { TONES, type Tone } from "@/components/palette";

export const dynamic = "force-dynamic";

function Stat({ label, value, hint, icon, tone }: { label: string; value: string; hint?: string; icon: string; tone: Tone }) {
  const t = TONES[tone];
  return (
    <div className="card relative overflow-hidden p-3.5 sm:p-5">
      <span className={`absolute inset-x-0 top-0 h-1 ${t.bar}`} />
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-stone-500 sm:text-sm">{label}</p>
        <span className={`grid size-8 place-items-center rounded-lg sm:size-10 sm:rounded-xl ${t.tile}`}>
          <Icon name={icon} className="size-4 sm:size-5" />
        </span>
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight sm:mt-3 sm:text-2xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  const ctx = await requireTenant();
  const showMoney = can(ctx.role, "report.view");

  const [user, branch, orders, tables, waiting, lowRatings, lowStock, day] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } }),
    db.branch.findUniqueOrThrow({ where: { businessId_id: { businessId: ctx.businessId, id: ctx.branchId } }, select: { name: true } }),
    listOpenOrders(ctx),
    listTables(ctx),
    inboxCount(ctx),
    can(ctx.role, "feedback.view") ? unresolvedCount(ctx) : 0,
    can(ctx.role, "stock.view") ? lowStockCount(ctx) : 0,
    showMoney ? getDayReport(ctx) : null,
  ]);
  const attendance = can(ctx.role, "time.manage") ? await getAttendance(ctx, localDate(new Date(), (await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } })).timezone)) : null;

  const occupied = new Set(orders.map((o) => o.tableId).filter(Boolean)).size;
  const occupancy = tables.length ? Math.round((occupied / tables.length) * 100) : 0;
  const firstName = user.name.split(/\s+/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const attention = [
    { show: waiting > 0, count: waiting, text: "guest orders or requests waiting", href: "/orders", tone: "bg-amber-50 text-amber-800" },
    { show: lowRatings > 0, count: lowRatings, text: "low ratings to look into", href: "/feedback", tone: "bg-red-50 text-red-800" },
    { show: lowStock > 0, count: lowStock, text: "stock items running low", href: "/stock", tone: "bg-amber-50 text-amber-800" },
  ].filter((a) => a.show);

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={10000} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">
            {greeting}, {firstName}
          </h1>
          <p className="text-sm text-stone-500">
            {branch.name} &middot; {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        {can(ctx.role, "order.create") && (
          <Link href="/orders" className="btn-primary">
            <Icon name="plus" className="size-4" /> New order
          </Link>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {day ? (
          <>
            <Stat label="Sales today" value={formatNpr(day.report.net)} hint="After refunds" icon="reports" tone="emerald" />
            <Stat label="Bills paid" value={String(day.report.sales.count)} hint={day.report.refunds.count ? `${day.report.refunds.count} refunded` : "No refunds"} icon="bills" tone="blue" />
            <Stat
              label="Average bill"
              value={day.report.sales.count ? formatNpr(day.report.sales.average) : "—"}
              hint="Per paid bill"
              icon="customers"
              tone="violet"
            />
          </>
        ) : null}
        <Stat label="Open orders" value={String(orders.length)} hint={orders.length ? "Waiting to be paid" : "Nothing open right now"} icon="orders" tone="orange" />
        {!day && <Stat label="Tables in use" value={`${occupied} / ${tables.length}`} icon="tables" tone="violet" />}
      </section>

      {attendance && (
        <Link href="/attendance" className="card flex items-center gap-4 p-4 active:bg-stone-50">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
            <Icon name="staff" className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Staff today</span>
            <span className="block text-sm text-stone-600">
              <strong className="text-emerald-700">{attendance.counts.in}</strong> in now · <strong>{attendance.counts.done}</strong> came and left ·{" "}
              <strong className="text-stone-500">{attendance.counts.off}</strong> off / not in
            </span>
          </span>
          <span className="text-sm font-medium text-brand-700">Details</span>
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Open orders</h2>
            <Link href="/orders" className="text-sm font-medium text-brand-700 hover:underline">
              See all
            </Link>
          </div>
          {orders.length === 0 ? (
            <p className="rounded-xl bg-stone-50 p-6 text-center text-sm text-stone-500">No open orders. New ones appear here as they are taken.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {orders.slice(0, 8).map((o) => {
                const active = o.items.filter((i) => i.status !== "CANCELLED");
                const total = active.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
                return (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-stone-50">
                      <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-sm font-semibold text-blue-700">#{o.number}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{o.table ? `Table ${o.table.label}` : "Takeaway"}</p>
                        <p className="text-xs text-stone-500">
                          {active.reduce((s, i) => s + i.quantity, 0)} item{active.reduce((s, i) => s + i.quantity, 0) === 1 ? "" : "s"} &middot; {o.status === "SERVED" ? "Served" : "In progress"}
                        </p>
                      </div>
                      <span className="text-sm font-semibold">{formatNpr(total)}</span>
                      <Icon name="chevron" className="size-4 text-stone-300" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="font-semibold">Floor</h2>
            <p className="mt-1 text-sm text-stone-500">
              {occupied} of {tables.length} tables in use
            </p>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-stone-100" role="img" aria-label={`${occupancy}% of tables in use`}>
              <div className="h-full rounded-full bg-violet-500" style={{ width: `${occupancy}%` }} />
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-2 font-semibold">Needs attention</h2>
            {attention.length === 0 ? (
              <p className="text-sm text-stone-500">All clear.</p>
            ) : (
              <ul className="space-y-2">
                {attention.map((a) => (
                  <li key={a.href}>
                    <Link href={a.href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${a.tone}`}>
                      <span className="text-lg font-semibold">{a.count}</span>
                      <span className="flex-1">{a.text}</span>
                      <Icon name="chevron" className="size-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {day && day.report.topItems.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Best sellers today</h2>
          <ul className="space-y-3">
            {day.report.topItems.slice(0, 5).map((t) => {
              const max = day.report.topItems[0]!.quantity || 1;
              return (
                <li key={t.name}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-stone-500">
                      {t.quantity} sold &middot; {formatNpr(t.revenue)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100">
                    <div className="h-full rounded-full bg-rose-400" style={{ width: `${(t.quantity / max) * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
