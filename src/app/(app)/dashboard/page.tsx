import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { db } from "@/server/db";
import { formatNpr } from "@/features/billing/calc";
import { getAttendance } from "@/features/payroll/server/time";
import { localDate } from "@/lib/business-day";
import { listOpenOrders, listTables } from "@/features/orders/server/service";
import { getDayReport } from "@/features/reports/server/service";
import { getDashboardCharts } from "@/features/reports/server/charts";
import { shortMoney } from "@/features/reports/charts";
import { BarChart, Donut, LineChart } from "@/components/charts";
import { inboxCount } from "@/features/guest/server/service";
import { unresolvedCount } from "@/features/feedback/server/service";
import { lowStockCount } from "@/features/stock/server/service";
import { onlineInboxCount } from "@/features/online/server/service";
import { reservationsWaitingCount } from "@/features/reservations/server/service";
import { hukkaAlertCount } from "@/features/hukka/server/service";
import { unseenAlertCount } from "@/features/owner/server/owner";
import { buildNav } from "@/features/nav/nav";
import { AutoRefresh } from "@/components/auto-refresh";
import { Icon } from "@/components/icons";

export const dynamic = "force-dynamic";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4 sm:p-5">
      <p className="text-sm font-medium text-stone-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  const ctx = await requireTenant();
  const showMoney = can(ctx, "report.view");

  const [business, user, branch, orders, tables, guestWaiting, lowRatings, lowStock, onlineWaiting, reservationsWaiting, hukkaLong, hukkaCategories, ownerAlerts, day] = await Promise.all([
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
    showMoney ? getDayReport(ctx) : null,
  ]);
  const charts = showMoney ? await getDashboardCharts(ctx) : null;
  const attendance = can(ctx, "time.manage") ? await getAttendance(ctx, localDate(new Date(), business.timezone)) : null;

  const occupied = new Set(orders.map((o) => o.tableId).filter(Boolean)).size;
  const occupancy = tables.length ? Math.round((occupied / tables.length) * 100) : 0;
  const firstName = user.name.split(/\s+/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const { sections } = buildNav({
    role: ctx.role,
    permissions: ctx.permissions,
    multiBranch: business.multiBranch,
    hukka: hukkaCategories > 0,
    counts: { guestWaiting, onlineWaiting, reservationsWaiting, hukkaLong, lowStock, lowRatings, ownerAlerts },
  });

  // What needs a person now, most urgent first. Each one is a link to where it is handled.
  const attention = [
    { n: onlineWaiting, text: "online orders waiting", href: "/online", urgent: true },
    { n: guestWaiting, text: "guest orders or requests waiting", href: "/orders", urgent: true },
    { n: hukkaLong, text: "hukkas running long", href: "/hukka", urgent: true },
    { n: reservationsWaiting, text: "table requests to answer", href: "/reservations", urgent: false },
    { n: ownerAlerts, text: "things to check", href: "/owner", urgent: true },
    { n: lowStock, text: "stock items running low", href: "/stock", urgent: false },
    { n: lowRatings, text: "low ratings to look into", href: "/feedback", urgent: false },
  ].filter((a) => a.n > 0);

  return (
    <div className="space-y-8">
      <AutoRefresh everyMs={10000} />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            {greeting}, {firstName}
          </h1>
          <p className="mt-0.5 text-sm text-stone-500">
            {business.multiBranch ? `${branch.name} · ` : ""}
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(ctx, "order.create") && (
            <Link href="/orders" className="btn-primary">
              <Icon name="plus" className="size-4" /> New order
            </Link>
          )}
          {can(ctx, "order.create") && can(ctx, "order.edit") && (
            <Link href="/quick" className="btn-secondary">
              Quick order
            </Link>
          )}
          {(can(ctx, "kitchen.update") || can(ctx, "order.edit")) && (
            <Link href="/kitchen" className="btn-secondary">
              Kitchen
            </Link>
          )}
        </div>
      </header>

      <section aria-label="Today in numbers" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {day && <Kpi label="Sales today" value={formatNpr(day.report.net)} hint="After refunds" />}
        {day && <Kpi label="Bills paid" value={String(day.report.sales.count)} hint={day.report.refunds.count ? `${day.report.refunds.count} refunded` : "No refunds"} />}
        {day && <Kpi label="Average bill" value={day.report.sales.count ? formatNpr(day.report.sales.average) : "-"} hint="Per paid bill" />}
        <Kpi label="Open orders" value={String(orders.length)} hint={orders.length ? "Waiting to be paid" : "Nothing open right now"} />
        {!day && <Kpi label="Tables in use" value={`${occupied} / ${tables.length}`} hint={`${occupancy}% of the floor`} />}
      </section>


      {charts && (
        <section aria-label="Sales charts" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="card p-5 lg:col-span-2">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-semibold">Sales by hour</h2>
                <span className="text-xs text-stone-500">Today, after refunds</span>
              </div>
              <BarChart values={charts.byHour} labels={charts.byHour.map((_, h) => String(h).padStart(2, "0"))} labelEvery={3} ariaLabel="Sales for each hour of today" />
            </div>
            <div className="card p-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-semibold">How customers paid</h2>
                <span className="text-xs text-stone-500">Today</span>
              </div>
              {charts.methods.length === 0 ? (
                <p className="rounded-xl bg-stone-50 p-6 text-center text-sm text-stone-500">No payments yet today.</p>
              ) : (
                <Donut slices={charts.methods} centre={shortMoney(charts.methodsTotal)} ariaLabel="Share of today's payments by method" format={formatNpr} />
              )}
            </div>
          </div>
          <div className="card p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">This week and last week</h2>
              <p className="text-sm text-stone-600">
                <strong>{formatNpr(charts.week.thisTotal)}</strong> in the last 7 days
                {charts.week.changePercent !== null && (
                  <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${charts.week.changePercent >= 0 ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
                    {charts.week.changePercent >= 0 ? "+" : ""}
                    {charts.week.changePercent}% on the 7 days before
                  </span>
                )}
              </p>
            </div>
            <LineChart
              ariaLabel="Daily sales for the last 7 days against the 7 days before"
              labels={charts.week.thisWeek.map((d) => new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }))}
              series={[
                { name: "Last 7 days", values: charts.week.thisWeek.map((d) => d.amount), color: "#4f46e5" },
                { name: "The 7 days before", values: charts.week.lastWeek.map((d) => d.amount), color: "#a8a29e", dashed: true },
              ]}
            />
            <div className="mt-2 flex gap-4 text-xs text-stone-600">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-5 bg-[#4f46e5]" /> Last 7 days
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0 w-5 border-t-2 border-dashed border-stone-400" /> The 7 days before ({formatNpr(charts.week.lastTotal)})
              </span>
            </div>
          </div>
        </section>
      )}

      {attention.length > 0 && (
        <section aria-label="Needs attention">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-stone-500">Needs attention</h2>
          <div className="flex flex-wrap gap-2">
            {attention.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${a.urgent ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}
              >
                <span className="text-base font-semibold tabular-nums">{a.n}</span>
                {a.text}
              </Link>
            ))}
          </div>
        </section>
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
              {orders.slice(0, 7).map((o) => {
                const active = o.items.filter((i) => i.status !== "CANCELLED");
                const count = active.reduce((s, i) => s + i.quantity, 0);
                const total = active.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
                return (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-stone-50">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-stone-100 text-sm font-semibold text-stone-700">#{o.number}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{o.table ? `Table ${o.table.label}` : o.type === "DELIVERY" ? "Delivery" : "Takeaway"}</p>
                        <p className="text-xs text-stone-500">
                          {count} item{count === 1 ? "" : "s"} · {o.status === "SERVED" ? "Served" : "In progress"}
                        </p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">{formatNpr(total)}</span>
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
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100" role="img" aria-label={`${occupancy}% of tables in use`}>
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${occupancy}%` }} />
            </div>
            {attendance && (
              <Link href="/attendance" className="mt-4 block rounded-xl bg-stone-50 p-3 text-sm hover:bg-stone-100">
                <span className="font-medium">Staff today</span>
                <span className="block text-stone-600">
                  <strong className="text-emerald-700">{attendance.counts.in}</strong> in now · <strong>{attendance.counts.done}</strong> left · <span className="text-stone-500">{attendance.counts.off} off</span>
                </span>
              </Link>
            )}
          </section>

          {day && day.report.topItems.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">Best sellers today</h2>
              <ul className="space-y-3">
                {day.report.topItems.slice(0, 4).map((t) => {
                  const max = day.report.topItems[0]!.quantity || 1;
                  return (
                    <li key={t.name}>
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{t.name}</span>
                        <span className="shrink-0 text-stone-500">{t.quantity} sold</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${(t.quantity / max) * 100}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>

      <section aria-label="Everything you can do">
        <h2 className="mb-4 text-xl font-semibold">Everything in one place</h2>
        <div className="space-y-6">
          {sections.map((s) => (
            <div key={s.id}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-stone-500">{s.label}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {s.items.map((e) => (
                  <Link key={e.href} href={e.href} className="card group relative flex items-start gap-3 p-4 transition-colors hover:border-brand-500">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 group-hover:bg-brand-100">
                      <Icon name={e.icon} className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-tight">{e.label}</span>
                      <span className="mt-0.5 block text-sm leading-snug text-stone-500">{e.description}</span>
                    </span>
                    {!!e.badge && e.badge > 0 && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${e.badgeTone === "alert" ? "bg-red-600" : "bg-amber-500"}`}>{e.badge}</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
