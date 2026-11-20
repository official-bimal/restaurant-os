import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { kitchenTickets } from "@/features/orders/server/service";
import { ticketAge, type TicketAge } from "@/features/orders/status";
import { AutoRefresh } from "@/components/auto-refresh";
import { kitchenStatusAction } from "./actions";

export const dynamic = "force-dynamic";

const AGE_STYLE: Record<TicketAge, string> = {
  FRESH: "border-stone-200 bg-white",
  WARNING: "border-amber-400 bg-amber-50",
  LATE: "border-red-500 bg-red-50",
};

export default async function KitchenPage() {
  const ctx = await requireTenant();
  const tickets = await kitchenTickets(ctx);
  const canUpdate = can(ctx, "kitchen.update");

  const byStation = new Map<string, typeof tickets>();
  for (const t of tickets) {
    const name = t.menuItem.station?.name ?? "Unassigned";
    byStation.set(name, [...(byStation.get(name) ?? []), t]);
  }

  return (
    <div className="space-y-4">
      <AutoRefresh />
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">Kitchen</h1>
        <span className="text-sm text-stone-500">Updates every few seconds</span>
        <Link href="/screen/kitchen" className="ml-auto rounded-lg border border-stone-300 px-3 py-1.5 text-sm">
          Big screen for a tablet or TV
        </Link>
      </div>
      {tickets.length === 0 && <p className="text-stone-500">No tickets waiting. New orders appear here.</p>}
      {[...byStation.entries()].map(([station, items]) => (
        <section key={station}>
          <h2 className="mb-2 font-semibold">
            {station} <span className="text-sm font-normal text-stone-500">({items.length})</span>
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((t) => {
              const minutes = t.ageMinutes;
              const age = t.status === "READY" ? "FRESH" : ticketAge(minutes, t.menuItem.prepMinutes);
              return (
                <li key={t.id} className={`rounded-xl border-2 p-3 ${AGE_STYLE[age]}`}>
                  <div className="flex justify-between text-sm text-stone-600">
                    <span>
                      #{t.order.number} · {t.order.table ? t.order.table.label : t.order.type === "DELIVERY" ? "Delivery" : "Takeaway"}
                    </span>
                    <span className={age === "LATE" ? "font-semibold text-red-700" : ""}>
                      {minutes} min{age === "LATE" ? " · late" : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-lg font-semibold">
                    {t.quantity} × {t.name}
                  </p>
                  {t.addOns.length > 0 && (
                    <p className="text-sm font-medium text-orange-700">{t.addOns.map((a) => a.name).join(" · ")}</p>
                  )}
                  {t.note && <p className="mt-1 rounded-md bg-amber-100 px-2 py-1 text-base font-semibold text-amber-950">⚠ {t.note}</p>}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs">{t.status.toLowerCase()}</span>
                    {canUpdate && t.status === "PENDING" && (
                      <KitchenButton itemId={t.id} to="PREPARING" label="Start" />
                    )}
                    {canUpdate && (t.status === "PENDING" || t.status === "PREPARING") && (
                      <KitchenButton itemId={t.id} to="READY" label="Ready" primary />
                    )}
                    {t.status === "READY" && <span className="text-xs text-blue-700">Waiting to be served</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function KitchenButton({
  itemId,
  to,
  label,
  primary,
}: {
  itemId: string;
  to: "PREPARING" | "READY";
  label: string;
  primary?: boolean;
}) {
  return (
    <form action={kitchenStatusAction.bind(null, itemId)}>
      <input type="hidden" name="to" value={to} />
      <button
        className={`min-h-11 rounded-lg px-4 text-sm font-medium ${
          primary ? "bg-green-700 text-white" : "border border-stone-300 hover:bg-stone-50"
        }`}
      >
        {label}
      </button>
    </form>
  );
}
