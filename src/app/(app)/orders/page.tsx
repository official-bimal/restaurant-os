import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { listOpenOrders, listTables } from "@/features/orders/server/service";
import { activeBands, activeZones } from "@/features/delivery/server/service";
import { formatKm } from "@/features/orders/server/delivery";
import { formatNpr } from "@/features/billing/calc";
import { createOrderAction } from "./actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { GuestInbox } from "./guest-inbox";
import { TableMap, type MapArea } from "./table-map";
import { tableAlerts } from "@/features/guest/server/service";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const ctx = await requireTenant();
  const { error } = await searchParams;
  const [orders, tables, zones, bands] = await Promise.all([listOpenOrders(ctx), listTables(ctx), activeZones(ctx), activeBands(ctx)]);
  // One key per page render: a double tap submits the same key, so only one order is made.
  const idempotencyKey = randomUUID();
  const alerts = await tableAlerts(ctx);
  // The floor map: each table, and what is on it right now.
  const byTable = new Map<string, typeof orders>();
  for (const o of orders) if (o.tableId) byTable.set(o.tableId, [...(byTable.get(o.tableId) ?? []), o]);
  const areas: MapArea[] = [];
  for (const t of tables) {
    let area = areas.find((a) => a.id === t.area.id);
    if (!area) areas.push((area = { id: t.area.id, name: t.area.name, tables: [] }));
    const open = (byTable.get(t.id) ?? []).slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const live = open.flatMap((o) => o.items.filter((i) => i.status !== "CANCELLED"));
    area.tables.push({
      id: t.id,
      label: t.label,
      capacity: t.capacity,
      orderId: open[0]?.id ?? null,
      bills: open.length,
      items: live.reduce((n, i) => n + i.quantity, 0),
      total: live.reduce((n, i) => n + i.unitPrice * i.quantity, 0),
      served: open.length > 0 && open.every((o) => o.status === "SERVED"),
      alert: alerts[t.id] ?? null,
      posX: t.posX,
      posY: t.posY,
    });
  }

  return (
    <div className="space-y-6">
      <AutoRefresh />
      {can(ctx, "order.edit") && <GuestInbox ctx={ctx} />}
      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {tables.length > 0 && (
        <section aria-label="Tables" className="card p-4">
          <h2 className="mb-3 text-lg font-semibold">Tables</h2>
          <TableMap areas={areas} keyBase={idempotencyKey} canCreate={can(ctx, "order.create")} />
        </section>
      )}

      {can(ctx, "order.create") && (
        <form action={createOrderAction} className="group card space-y-4 p-4">
          <h2 className="text-lg font-semibold">Takeaway or delivery</h2>
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <div role="radiogroup" aria-label="Order type" className="flex flex-wrap gap-2">
            {[
              { value: "TAKEAWAY", label: "Takeaway" },
              { value: "DELIVERY", label: "Delivery" },
            ].map((t, i) => (
              <label
                key={t.value}
                className="cursor-pointer rounded-xl border border-stone-300 px-4 py-2 text-sm font-medium has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700"
              >
                <input type="radio" name="type" value={t.value} defaultChecked={i === 0} className="sr-only" />
                {t.label}
              </label>
            ))}
          </div>

          <div className="hidden gap-3 group-has-[input[value=DELIVERY]:checked]:grid sm:grid-cols-3">
            <label className="text-sm font-medium">
              Customer name
              <input name="deliveryName" maxLength={80} className="mt-1 block w-full px-3 py-2" />
            </label>
            <label className="text-sm font-medium">
              Phone
              <input name="deliveryPhone" type="tel" inputMode="tel" placeholder="98XXXXXXXX" className="mt-1 block w-full px-3 py-2" />
            </label>
            <label className="text-sm font-medium">
              Address
              <input name="deliveryAddress" maxLength={200} className="mt-1 block w-full px-3 py-2" />
            </label>
            <label className="text-sm font-medium sm:col-span-3">
              Customer location (optional)
              <input name="deliveryLocation" placeholder="27.7172, 85.324 or paste a map link" className="mt-1 block w-full px-3 py-2" />
              <span className="mt-1 block text-xs font-normal text-stone-500">
                Gives the distance and delivery fee automatically, and a point on the delivery map.
              </span>
            </label>
            {bands.length > 0 && (
              <label className="text-sm font-medium sm:col-span-3">
                Distance (km) <span className="font-normal text-stone-500">(only if you gave no location)</span>
                <input name="deliveryDistanceKm" type="number" min={0.1} step="0.1" placeholder="e.g. 2.5" className="mt-1 block w-full max-w-xs px-3 py-2" />
                <span className="mt-1 block text-xs font-normal text-stone-500">
                  From a map app. We deliver up to {formatKm(Math.max(...bands.map((b) => b.upToMeters)))}.
                </span>
              </label>
            )}
            {bands.length === 0 && zones.length > 0 && (
              <label className="text-sm font-medium sm:col-span-3">
                Delivery area
                <select name="deliveryZoneId" className="mt-1 block w-full max-w-xs px-3 py-2">
                  <option value="">Choose an area</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} · {formatNpr(z.fee)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <button className="btn-primary min-h-11">Start order</button>
        </form>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">Open orders ({orders.length})</h2>
        {orders.length === 0 ? (
          <p className="text-stone-500">No open orders. Start one above.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {orders.map((o) => {
              const active = o.items.filter((i) => i.status !== "CANCELLED");
              const total = active.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
              return (
                <li key={o.id}>
                  <Link
                    href={`/orders/${o.id}`}
                    className="block rounded-2xl bg-white p-4 border border-stone-200 shadow-sm hover:ring-stone-400"
                  >
                    <div className="flex justify-between">
                      <span className="font-semibold">
                        #{o.number} · {o.table ? o.table.label : o.type === "DELIVERY" ? "Delivery" : "Takeaway"}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          o.status === "SERVED" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {o.status.toLowerCase()}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-stone-600">
                      {active.length} item{active.length === 1 ? "" : "s"} · {formatNpr(total)} before charges
                    </p>
                    {o.type === "DELIVERY" && o.deliveryStatus && (
                      <p className="mt-1 text-xs font-medium text-orange-700">
                        {o.deliveryStatus.replaceAll("_", " ").toLowerCase()} · {o.deliveryAddress}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
