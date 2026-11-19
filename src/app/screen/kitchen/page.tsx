import type { Metadata } from "next";
import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { kitchenTickets } from "@/features/orders/server/service";
import { ticketAge, type TicketAge } from "@/features/orders/status";
import { listRunningHukkas } from "@/features/hukka/server/service";
import { clockText, hukkaState, minutesSince } from "@/features/hukka/hukka";
import { AutoRefresh } from "@/components/auto-refresh";
import { screenStatusAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Kitchen screen", robots: { index: false, follow: false } };

const AGE: Record<TicketAge, string> = {
  FRESH: "border-stone-600 bg-stone-800",
  WARNING: "border-amber-400 bg-amber-950",
  LATE: "border-red-500 bg-red-950",
};
const HUKKA = { FRESH: "border-stone-600 bg-stone-800", LATE_SOON: "border-amber-400 bg-amber-950", RUNNING_LONG: "border-red-500 bg-red-950" } as const;

/** A full-screen board for the kitchen or bar: big type, dark background, no menu. Open it on a spare tablet or TV. */
export default async function KitchenScreen({ searchParams }: PageProps<"/screen/kitchen">) {
  const ctx = await requireTenant();
  const sp = await searchParams;
  const station = typeof sp.station === "string" ? sp.station : "";
  const [all, hukkas] = await Promise.all([kitchenTickets(ctx), can(ctx.role, "order.edit") || can(ctx.role, "kitchen.update") ? listRunningHukkas(ctx) : Promise.resolve([])]);
  const stations = [...new Set(all.map((t) => t.menuItem.station?.name ?? "Unassigned"))].sort();
  const tickets = station ? all.filter((t) => (t.menuItem.station?.name ?? "Unassigned") === station) : all;
  const canUpdate = can(ctx.role, "kitchen.update");
  const back = `/screen/kitchen${station ? `?station=${encodeURIComponent(station)}` : ""}`;
  const now = new Date();
  const late = tickets.filter((t) => t.status !== "READY" && ticketAge(t.ageMinutes, t.menuItem.prepMinutes) === "LATE").length;

  return (
    <main className="min-h-screen bg-stone-950 p-4 text-stone-50">
      <AutoRefresh everyMs={3000} />
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Kitchen</h1>
        {late > 0 && <span className="rounded-full bg-red-600 px-3 py-1 text-sm font-semibold">{late} late</span>}
        <Link href="/screen/kitchen" className={`rounded-full px-4 py-2 text-sm ${!station ? "bg-white text-black" : "bg-stone-800"}`}>
          All
        </Link>
        {stations.map((s) => (
          <Link key={s} href={`/screen/kitchen?station=${encodeURIComponent(s)}`} className={`rounded-full px-4 py-2 text-sm ${station === s ? "bg-white text-black" : "bg-stone-800"}`}>
            {s}
          </Link>
        ))}
        <Link href="/kitchen" className="rounded-full bg-stone-800 px-4 py-2 text-sm">
          Leave full screen
        </Link>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section aria-label="Tickets">
          {tickets.length === 0 && <p className="py-16 text-center text-2xl text-stone-400">No tickets waiting.</p>}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tickets.map((t) => {
              const age = t.status === "READY" ? "FRESH" : ticketAge(t.ageMinutes, t.menuItem.prepMinutes);
              return (
                <li key={t.id} className={`rounded-2xl border-4 p-4 ${AGE[age]}`}>
                  <div className="flex justify-between text-lg text-stone-300">
                    <span>
                      #{t.order.number} · {t.order.table ? t.order.table.label : t.order.type === "DELIVERY" ? "Delivery" : "Takeaway"}
                    </span>
                    <span className={age === "LATE" ? "font-bold text-red-400" : ""}>{t.ageMinutes} min</span>
                  </div>
                  <p className="mt-1 text-3xl font-bold leading-tight">
                    {t.quantity} × {t.name}
                  </p>
                  {t.addOns.length > 0 && <p className="text-xl font-semibold text-orange-300">{t.addOns.map((a) => a.name).join(" · ")}</p>}
                  {t.note && <p className="mt-2 rounded-lg bg-amber-400 px-3 py-2 text-2xl font-bold text-black">⚠ {t.note}</p>}
                  <div className="mt-3 flex items-center gap-3">
                    <span className="rounded-full bg-stone-700 px-3 py-1 text-sm uppercase">{t.status.toLowerCase()}</span>
                    {canUpdate && t.status === "PENDING" && (
                      <form action={screenStatusAction.bind(null, t.id, back)}>
                        <input type="hidden" name="to" value="PREPARING" />
                        <button className="min-h-14 rounded-xl bg-stone-600 px-6 text-xl font-semibold">Start</button>
                      </form>
                    )}
                    {canUpdate && (t.status === "PENDING" || t.status === "PREPARING") && (
                      <form action={screenStatusAction.bind(null, t.id, back)}>
                        <input type="hidden" name="to" value="READY" />
                        <button className="min-h-14 rounded-xl bg-green-600 px-6 text-xl font-semibold">Ready</button>
                      </form>
                    )}
                    {t.status === "READY" && <span className="text-lg text-sky-300">Waiting to be served</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {hukkas.length > 0 && (
          <aside aria-label="Hukka timers" className="space-y-3">
            <h2 className="text-xl font-semibold">Hukka ({hukkas.length})</h2>
            {hukkas.map((h) => {
              const elapsed = minutesSince(h.startedAt, now);
              const state = hukkaState(elapsed, h.alertMinutes);
              return (
                <div key={h.id} className={`rounded-2xl border-4 p-3 ${HUKKA[state]}`}>
                  <p className="text-lg font-semibold">
                    {h.name} <span className="text-base font-normal text-stone-300">· {h.tableLabel ?? "No table"}</span>
                  </p>
                  <p className="text-3xl font-bold tabular-nums">{clockText(elapsed)}</p>
                  <p className="text-sm text-stone-300">
                    {state === "RUNNING_LONG" ? "Running long · " : state === "LATE_SOON" ? "Nearly at the alert · " : ""}
                    {h.coils} extra coil{h.coils === 1 ? "" : "s"}
                  </p>
                </div>
              );
            })}
          </aside>
        )}
      </div>
    </main>
  );
}
