import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { formatNpr } from "@/features/billing/calc";
import { getDispatchBoard, getRiderAccounts } from "@/features/delivery/server/dispatch";
import { listBatches } from "@/features/delivery/server/batches";
import { formatKm } from "@/features/orders/server/delivery";
import { AutoRefresh } from "@/components/auto-refresh";
import {
  assignRunAction,
  cancelRunAction,
  dispatchAssignAction,
  handInAction,
  makeRunAction,
  payoutAction,
  removeStopAction,
  setRiderPayAction,
  startRunAction,
} from "./actions";

export const dynamic = "force-dynamic";

type Card = Awaited<ReturnType<typeof getDispatchBoard>>["unassigned"][number];

const field = "min-h-9 px-2 text-sm";
const smallBtn = "min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50";

function OrderCard({ c, riders, assign, pick }: { c: Card; riders?: { userId: string; name: string; load: number }[]; assign?: boolean; pick?: boolean }) {
  return (
    <li className="card space-y-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2">
          {pick && <input type="checkbox" name="order" value={c.id} form="run-form" aria-label={`Put order ${c.number} in a run`} />}
          <Link href={`/orders/${c.id}`} className="font-semibold hover:underline">
            #{c.number}
          </Link>
        </span>
        <span className="text-xs text-stone-500">{c.minutesOpen} min</span>
      </div>
      <p className="text-sm">{c.customerName ?? "Customer"}</p>
      <p className="text-xs text-stone-600">{c.address}</p>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="rounded-full bg-stone-100 px-2 py-0.5">{c.items} item{c.items === 1 ? "" : "s"}</span>
        {c.ready && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">Food ready</span>}
        {c.paid ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">Paid</span> : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">Cash on delivery</span>}
        {c.zone && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-800">{c.zone}</span>}
      </div>
      {c.riderName && <p className="text-xs text-stone-600">Rider: {c.riderName}</p>}
      {assign && riders && (
        <form action={dispatchAssignAction.bind(null, c.id)} className="flex gap-2">
          <select name="riderUserId" required aria-label={`Rider for order ${c.number}`} className={`min-w-0 flex-1 ${field}`}>
            <option value="">{riders.length ? "Choose a rider" : "No riders in this branch"}</option>
            {riders.map((r) => (
              <option key={r.userId} value={r.userId}>
                {r.name} ({r.load} active)
              </option>
            ))}
          </select>
          <button className={smallBtn} disabled={riders.length === 0}>
            Assign
          </button>
        </form>
      )}
    </li>
  );
}

function Column({ title, tone, children, count }: { title: string; tone: string; children: React.ReactNode; count: number }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className={`size-2.5 rounded-full ${tone}`} />
        {title} <span className="font-normal text-stone-500">({count})</span>
      </h2>
      {count === 0 ? <p className="rounded-xl bg-stone-100/70 p-4 text-center text-xs text-stone-500">Nothing here</p> : <ul className="space-y-3">{children}</ul>}
    </section>
  );
}

export default async function DispatchPage({ searchParams }: PageProps<"/dispatch">) {
  const ctx = await requireTenant("order.edit");
  const { error } = await searchParams;
  const [board, runs] = await Promise.all([getDispatchBoard(ctx), listBatches(ctx)]);
  const accounts = can(ctx.role, "rider.settle") ? await getRiderAccounts(ctx) : [];
  const canPay = can(ctx.role, "staff.manage");

  return (
    <div className="space-y-8">
      <AutoRefresh everyMs={8000} />
      <div>
        <h1 className="text-2xl font-semibold">Dispatch</h1>
        <p className="text-sm text-stone-500">Deliveries in this branch. Updates by itself.</p>
      </div>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {board.unassigned.length + board.waiting.length >= 2 && (
        <form id="run-form" action={makeRunAction} className="card flex flex-wrap items-center gap-3 p-3 text-sm">
          <span className="font-medium">Tick two or more deliveries below to send one rider on a single trip.</span>
          <select name="riderUserId" aria-label="Rider for the run" className={field}>
            <option value="">Choose the rider later</option>
            {board.riders.map((r) => (
              <option key={r.userId} value={r.userId}>
                {r.name} ({r.load} active)
              </option>
            ))}
          </select>
          <button className={smallBtn}>Make a run</button>
        </form>
      )}

      {runs.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Runs</h2>
          {runs.map((r) => (
            <article key={r.id} className="card space-y-3 border-blue-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {r.orders.length} stops · {r.plannedMeters > 0 ? `about ${formatKm(r.plannedMeters)}` : "length not known (set the branch location)"}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${r.status === "OUT" ? "bg-orange-100 text-orange-800" : "bg-blue-100 text-blue-800"}`}>
                    {r.status === "OUT" ? "On the road" : "Planned"}
                  </span>
                </p>
                <span className="text-sm text-stone-600">{r.riderName ? `Rider: ${r.riderName}` : "No rider yet"}</span>
              </div>
              <ol className="space-y-1.5 text-sm">
                {r.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2">
                    <span>
                      <span className="mr-2 inline-grid size-6 place-items-center rounded-full bg-blue-600 text-xs font-semibold text-white">{o.batchStop}</span>
                      <Link href={`/orders/${o.id}`} className="font-medium hover:underline">
                        #{o.number}
                      </Link>{" "}
                      {o.deliveryName ?? "Customer"} <span className="text-stone-500">· {o.deliveryAddress}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-stone-500">
                      {o.deliveryStatus === "DELIVERED" ? "Delivered" : o.deliveryStatus === "FAILED" ? "Failed" : ""}
                      {r.status === "PLANNED" && (
                        <form action={removeStopAction.bind(null, o.id)}>
                          <button className="text-red-700 underline">Take out</button>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
              {r.status === "PLANNED" && (
                <div className="flex flex-wrap items-end gap-3">
                  <form action={assignRunAction.bind(null, r.id)} className="flex items-end gap-2">
                    <select name="riderUserId" required defaultValue={r.riderUserId ?? ""} aria-label="Rider" className={field}>
                      <option value="">Choose a rider</option>
                      {board.riders.map((x) => (
                        <option key={x.userId} value={x.userId}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                    <button className={smallBtn}>{r.riderUserId ? "Change rider" : "Give to rider"}</button>
                  </form>
                  <form action={startRunAction.bind(null, r.id)}>
                    <button className="min-h-9 rounded-lg bg-orange-600 px-3 text-sm font-medium text-white hover:bg-orange-700" disabled={!r.riderName}>
                      Send the run out
                    </button>
                  </form>
                  <form action={cancelRunAction.bind(null, r.id)}>
                    <button className="text-sm text-red-700 underline">Break up</button>
                  </form>
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-4">
        <Column title="Needs a rider" tone="bg-red-500" count={board.unassigned.length}>
          {board.unassigned.map((c) => (
            <OrderCard key={c.id} c={c} riders={board.riders} assign pick />
          ))}
        </Column>
        <Column title="Assigned, waiting" tone="bg-amber-500" count={board.waiting.length}>
          {board.waiting.map((c) => (
            <OrderCard key={c.id} c={c} pick />
          ))}
        </Column>
        <Column title="On the road" tone="bg-orange-500" count={board.out.length}>
          {board.out.map((c) => (
            <OrderCard key={c.id} c={c} />
          ))}
        </Column>
        <Column title="Finished today" tone="bg-emerald-500" count={board.finished.length}>
          {board.finished.map((c) => (
            <li key={c.id} className="card flex items-center justify-between gap-2 p-3 text-sm">
              <Link href={`/orders/${c.id}`} className="font-medium hover:underline">
                #{c.number}
              </Link>
              <span className="truncate text-xs text-stone-500">{c.riderName ?? "—"}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${c.status === "DELIVERED" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                {c.status === "DELIVERED" ? "Delivered" : "Failed"}
              </span>
            </li>
          ))}
        </Column>
      </div>

      {board.riders.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Riders in this branch</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {board.riders.map((r) => (
              <li key={r.userId} className="rounded-full border border-stone-200 bg-white px-3 py-1.5">
                {r.name} · {r.load === 0 ? "free" : `${r.load} active${r.onTheRoad ? `, ${r.onTheRoad} on the road` : ""}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {accounts.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Rider cash and pay</h2>
            <p className="text-sm text-stone-500">
              Cash is what a rider collected at the door for unpaid bills and has not handed in yet. Pay is what they earned for delivered orders
              at their rate and has not been paid out. Entries are only ever added, never changed.
            </p>
          </div>
          {accounts.map((a) => (
            <article key={a.userId} className="card space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{a.name}</h3>
                <span className="text-sm text-stone-500">{a.deliveries} delivered</span>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-amber-50 p-3">
                  <dt className="text-xs font-medium text-amber-900">Holding cash from customers</dt>
                  <dd className="text-xl font-semibold">{formatNpr(a.cashOwed)}</dd>
                  <dd className="text-xs text-stone-500">
                    {formatNpr(a.collected)} collected, {formatNpr(a.handedIn)} handed in
                  </dd>
                </div>
                <div className="rounded-xl bg-emerald-50 p-3">
                  <dt className="text-xs font-medium text-emerald-900">Pay due to the rider</dt>
                  <dd className="text-xl font-semibold">{formatNpr(a.payDue)}</dd>
                  <dd className="text-xs text-stone-500">
                    {formatNpr(a.earned)} earned, {formatNpr(a.paidOut)} paid
                  </dd>
                </div>
              </dl>
              <div className="grid gap-3 lg:grid-cols-3">
                <form action={handInAction.bind(null, a.userId)} className="space-y-2 rounded-xl bg-stone-50 p-3">
                  <p className="text-sm font-medium">Record cash handed in</p>
                  <input name="amount" type="number" min={0.01} step="0.01" required placeholder="Rs" aria-label={`Cash handed in by ${a.name}`} className={`w-full ${field}`} />
                  <input name="note" maxLength={200} placeholder="Note (optional)" className={`w-full ${field}`} />
                  <button className={smallBtn}>Record</button>
                </form>
                <form action={payoutAction.bind(null, a.userId)} className="space-y-2 rounded-xl bg-stone-50 p-3">
                  <p className="text-sm font-medium">Record a pay-out</p>
                  <input name="amount" type="number" min={0.01} step="0.01" required placeholder="Rs" aria-label={`Pay-out to ${a.name}`} className={`w-full ${field}`} />
                  <input name="note" maxLength={200} placeholder="Note (optional)" className={`w-full ${field}`} />
                  <button className={smallBtn}>Record</button>
                </form>
                {canPay && (
                  <form action={setRiderPayAction.bind(null, a.userId)} className="space-y-2 rounded-xl bg-stone-50 p-3">
                    <p className="text-sm font-medium">Pay per delivery</p>
                    <input name="pay" type="number" min={0} step="0.01" defaultValue={a.deliveryPay / 100} aria-label={`Pay per delivery for ${a.name}`} className={`w-full ${field}`} />
                    <p className="text-xs text-stone-500">Applies to deliveries from now on.</p>
                    <button className={smallBtn}>Save</button>
                  </form>
                )}
              </div>
              {a.entries.length > 0 && (
                <ul className="divide-y divide-stone-100 text-sm">
                  {a.entries.map((e) => (
                    <li key={e.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span>
                        {e.kind === "CASH_HANDIN" ? "Handed in cash" : "Paid out"}
                        {e.note && <span className="text-stone-500"> · {e.note}</span>}
                      </span>
                      <span className="text-stone-600">
                        {formatNpr(e.amount)} · {e.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
