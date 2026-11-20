import Link from "next/link";
import type { ReactNode } from "react";
import { formatNpr } from "@/features/billing/calc";
import { shortMoney } from "@/features/reports/charts";
import { BarChart, Donut, LineChart } from "@/components/charts";
import { Icon } from "@/components/icons";
import { can, type PermissionSubject } from "@/server/permissions";
import type { Size, Template } from "./layout";
import type { DashboardData } from "./server/data";

/**
 * What each widget draws. A renderer gets the loaded data, its size, the template and who is looking, and returns the card (or null when
 * there is nothing true to show). Add a widget here after adding it to registry.ts; nothing else changes.
 */

export interface WidgetProps {
  d: DashboardData;
  size: Size;
  t: Template;
  who: PermissionSubject;
}

function Kpi({ label, value, hint, icon, t, size }: { label: string; value: string; hint?: string; icon: string; t: Template; size: Size }) {
  if (t === "COMPACT") {
    return (
      <div className="dash-card flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-stone-500">{label}</p>
          <p className="dash-kpi font-semibold tabular-nums tracking-tight">{value}</p>
        </div>
        {size === "M" && hint && <p className="text-right text-xs text-stone-500">{hint}</p>}
      </div>
    );
  }
  return (
    <div className="dash-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-stone-500">{label}</p>
        {t === "MODERN" && (
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <Icon name={icon} className="size-5" />
          </span>
        )}
      </div>
      <p className="dash-kpi mt-1.5 font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

function Panel({ title, note, link, children }: { title: string; note?: string; link?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section className="dash-card h-full">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="dash-h font-semibold">{title}</h2>
        {note && <span className="text-xs text-stone-500">{note}</span>}
        {link && (
          <Link href={link.href} className="text-sm font-medium text-brand-700 hover:underline">
            {link.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-xl bg-stone-50 p-5 text-center text-sm text-stone-500">{children}</p>;

const METHOD: Record<string, string> = { CASH: "Cash", CARD: "Card", QR: "QR / wallet", CREDIT: "On credit" };

export const RENDERERS: Record<string, (p: WidgetProps) => ReactNode> = {
  salesToday: ({ d, t, size }) => d.day && <Kpi t={t} size={size} icon="reports" label="Sales today" value={formatNpr(d.day.report.net)} hint="After refunds" />,
  billsPaid: ({ d, t, size }) => d.day && <Kpi t={t} size={size} icon="bills" label="Bills paid" value={String(d.day.report.sales.count)} hint={d.day.report.refunds.count ? `${d.day.report.refunds.count} refunded` : "No refunds"} />,
  averageBill: ({ d, t, size }) => d.day && <Kpi t={t} size={size} icon="orders" label="Average bill" value={d.day.report.sales.count ? formatNpr(d.day.report.sales.average) : "-"} hint="Per paid bill" />,
  revenue7: ({ d, t, size }) =>
    d.charts && (
      <Kpi
        t={t}
        size={size}
        icon="reports"
        label="Revenue, last 7 days"
        value={formatNpr(d.charts.week.thisTotal)}
        hint={d.charts.week.changePercent === null ? "Nothing to compare with yet" : `${d.charts.week.changePercent >= 0 ? "+" : ""}${d.charts.week.changePercent}% on the 7 days before`}
      />
    ),
  openOrders: ({ d, t, size }) => <Kpi t={t} size={size} icon="orders" label="Open orders" value={String(d.orders.length)} hint={d.orders.length ? "Waiting to be paid" : "Nothing open right now"} />,
  tablesInUse: ({ d, t, size }) => <Kpi t={t} size={size} icon="tables" label="Tables in use" value={`${d.occupied} / ${d.tables.length}`} hint={`${d.occupancy}% of the floor`} />,
  stockAlerts: ({ d, t, size }) => <Kpi t={t} size={size} icon="stock" label="Inventory alerts" value={String(d.lowStock)} hint={d.lowStock ? "Items at or below their level" : "Everything is stocked"} />,

  salesByHour: ({ d }) =>
    d.charts && (
      <Panel title="Sales by hour" note="Today, after refunds">
        <BarChart values={d.charts.byHour} labels={d.charts.byHour.map((_, h) => String(h).padStart(2, "0"))} labelEvery={3} ariaLabel="Sales for each hour of today" />
      </Panel>
    ),
  paymentBreakdown: ({ d }) =>
    d.charts && (
      <Panel title="How customers paid" note="Today">
        {d.charts.methods.length === 0 ? <Empty>No payments yet today.</Empty> : <Donut slices={d.charts.methods} centre={shortMoney(d.charts.methodsTotal)} ariaLabel="Share of today's payments by method" format={formatNpr} />}
      </Panel>
    ),
  weekCompare: ({ d }) => {
    const c = d.charts;
    if (!c) return null;
    return (
      <Panel title="This week and last week">
        <p className="mb-2 text-sm text-stone-600">
          <strong>{formatNpr(c.week.thisTotal)}</strong> in the last 7 days
          {c.week.changePercent !== null && (
            <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${c.week.changePercent >= 0 ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
              {c.week.changePercent >= 0 ? "+" : ""}
              {c.week.changePercent}% on the 7 days before
            </span>
          )}
        </p>
        <LineChart
          ariaLabel="Daily sales for the last 7 days against the 7 days before"
          labels={c.week.thisWeek.map((x) => new Date(`${x.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }))}
          series={[
            { name: "Last 7 days", values: c.week.thisWeek.map((x) => x.amount), color: "var(--color-brand-600)" },
            { name: "The 7 days before", values: c.week.lastWeek.map((x) => x.amount), color: "var(--chart-muted)", dashed: true },
          ]}
        />
        <div className="mt-2 flex gap-4 text-xs text-stone-600">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 bg-brand-600" /> Last 7 days
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-5 border-t-2 border-dashed border-stone-400" /> The 7 days before ({formatNpr(c.week.lastTotal)})
          </span>
        </div>
      </Panel>
    );
  },

  attention: ({ d }) =>
    d.attention.length === 0 ? null : (
    <Panel title="Needs attention">
      {d.attention.length === 0 ? (
        <Empty>Nothing is waiting. Alerts show up here.</Empty>
      ) : (
        <div className="flex flex-wrap gap-2">
          {d.attention.map((a) => (
            <Link key={a.href} href={a.href} className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${a.urgent ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
              <span className="text-base font-semibold tabular-nums">{a.n}</span>
              {a.text}
            </Link>
          ))}
        </div>
      )}
    </Panel>
  ),
  openOrdersList: ({ d }) => (
    <Panel title="Open orders" link={{ href: "/orders", label: "See all" }}>
      {d.orders.length === 0 ? (
        <Empty>No open orders. New ones appear here as they are taken.</Empty>
      ) : (
        <ul className="divide-y divide-stone-100">
          {d.orders.slice(0, 7).map((o) => {
            const active = o.items.filter((i) => i.status !== "CANCELLED");
            const count = active.reduce((s, i) => s + i.quantity, 0);
            const total = active.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
            return (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-stone-50">
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
    </Panel>
  ),
  topSelling: ({ d }) => {
    const top = d.day?.report.topItems ?? [];
    return (
      <Panel title="Best sellers today">
        {top.length === 0 ? (
          <Empty>No sales yet today.</Empty>
        ) : (
          <ul className="space-y-3">
            {top.slice(0, 5).map((x) => (
              <li key={x.name}>
                <div className="flex justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{x.name}</span>
                  <span className="shrink-0 text-stone-500">{x.quantity} sold</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(x.quantity / (top[0]!.quantity || 1)) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    );
  },
  lowStockProducts: ({ d }) => (
    <Panel title="Low stock products" link={{ href: "/stock", label: "Open stock" }}>
      {d.lowStockItems.length === 0 ? (
        <Empty>Nothing is running low.</Empty>
      ) : (
        <ul className="divide-y divide-stone-100">
          {d.lowStockItems.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate font-medium">{s.name}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.out ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
                {s.out ? "Out" : "Low"} · {s.quantity} {s.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  ),
  recentTransactions: ({ d }) => (
    <Panel title="Recent transactions" link={{ href: "/bills", label: "All bills" }}>
      {d.recent.length === 0 ? (
        <Empty>No bills have been paid yet.</Empty>
      ) : (
        <ul className="divide-y divide-stone-100">
          {d.recent.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">Bill #{r.number}</span>
                <span className="block text-xs text-stone-500">
                  {r.at.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: d.business.timezone })}
                  {r.method ? ` · ${METHOD[r.method] ?? r.method}` : ""}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{formatNpr(r.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  ),
  customerOverview: ({ d }) =>
    d.customers && (
      <Panel title="Customer overview" link={{ href: "/customers", label: "See customers" }}>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {(
            [
              ["On file", d.customers.total],
              ["New this week", d.customers.newWeek],
              ["Came back", d.customers.returning],
              ["Can be messaged", d.customers.withConsent],
            ] as [string, number][]
          ).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-stone-50 p-3">
              <dt className="text-xs text-stone-500">{k}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    ),
  floor: ({ d }) => (
    <Panel title="Floor">
      <p className="text-sm text-stone-500">
        {d.occupied} of {d.tables.length} tables in use
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100" role="img" aria-label={`${d.occupancy}% of tables in use`}>
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${d.occupancy}%` }} />
      </div>
      {d.attendance && (
        <Link href="/attendance" className="mt-4 block rounded-xl bg-stone-50 p-3 text-sm hover:bg-stone-100">
          <span className="font-medium">Staff today</span>
          <span className="block text-stone-600">
            <strong className="text-emerald-700">{d.attendance.counts.in}</strong> in now · <strong>{d.attendance.counts.done}</strong> left · <span className="text-stone-500">{d.attendance.counts.off} off</span>
          </span>
        </Link>
      )}
    </Panel>
  ),
  quickActions: ({ who }) => {
    const items: { href: string; label: string; icon: string }[] = [
      ...(can(who, "order.create") ? [{ href: "/orders", label: "New order", icon: "plus" }] : []),
      ...(can(who, "order.create") && can(who, "order.edit") ? [{ href: "/quick", label: "Quick order", icon: "orders" }] : []),
      ...(can(who, "kitchen.update") || can(who, "order.edit") ? [{ href: "/kitchen", label: "Kitchen", icon: "kitchen" }] : []),
      ...(can(who, "bills.view") ? [{ href: "/bills", label: "Bills", icon: "bills" }] : []),
      ...(can(who, "drawer.use") ? [{ href: "/drawer", label: "Cash drawer", icon: "bills" }] : []),
      ...(can(who, "stock.view") ? [{ href: "/stock", label: "Stock", icon: "stock" }] : []),
      ...(can(who, "menu.manage") ? [{ href: "/menu", label: "Menu", icon: "menu" }] : []),
      ...(can(who, "report.view") ? [{ href: "/reports", label: "Reports", icon: "reports" }] : []),
    ].slice(0, 8);
    if (items.length === 0) return null;
    return (
      <Panel title="Quick actions">
        <div className="grid grid-cols-2 gap-2">
          {items.map((i) => (
            <Link key={i.href} href={i.href} className="flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2.5 text-sm font-medium hover:border-brand-500 hover:bg-brand-50">
              <Icon name={i.icon} className="size-4 text-brand-600" />
              {i.label}
            </Link>
          ))}
        </div>
      </Panel>
    );
  },
  everything: ({ d }) => (
    <section aria-label="Everything you can do" className="dash-card">
      <h2 className="dash-h mb-4 font-semibold">Everything in one place</h2>
      <div className="space-y-5">
        {d.sections.map((s) => (
          <div key={s.id}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">{s.label}</h3>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {s.items.map((e) => (
                <Link key={e.href} href={e.href} className="group relative flex items-start gap-3 rounded-xl border border-stone-200 p-3 transition-colors hover:border-brand-500">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 group-hover:bg-brand-100">
                    <Icon name={e.icon} className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-tight">{e.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-stone-500">{e.description}</span>
                  </span>
                  {!!e.badge && e.badge > 0 && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${e.badgeTone === "alert" ? "bg-red-600" : "bg-amber-500"}`}>{e.badge}</span>}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  ),
};
