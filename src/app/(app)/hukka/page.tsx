import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { AutoRefresh } from "@/components/auto-refresh";
import { getHukkaBoard } from "@/features/hukka/server/service";
import { clockText, hukkaState, minutesSince } from "@/features/hukka/hukka";
import { addCoilAction, finishHukkaAction, startHukkaAction } from "./actions";

export const dynamic = "force-dynamic";

const TONE = {
  FRESH: "border-stone-200 bg-white",
  LATE_SOON: "border-amber-400 bg-amber-50",
  RUNNING_LONG: "border-red-500 bg-red-50",
} as const;

export default async function HukkaPage({ searchParams }: PageProps<"/hukka">) {
  const ctx = await requireTenant("order.edit");
  const sp = await searchParams;
  const { running, waiting, last24h } = await getHukkaBoard(ctx);
  const now = new Date();
  return (
    <div className="space-y-4">
      <AutoRefresh everyMs={15000} />
      <h1 className="text-xl font-semibold">Hukka timer</h1>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}
      <p className="text-sm text-stone-600">
        Start the timer when a hukka is served. It turns amber near the alert time and red when it runs long, so the waiter can offer a new coil or the bill. An extra coil is
        added to the bill for you. A hukka ends when you finish it or when its bill is paid.
      </p>

      <section aria-label="Waiting to start" className="space-y-2">
        <h2 className="font-semibold">Ordered, not started ({waiting.length})</h2>
        {waiting.length === 0 && <p className="card p-3 text-sm text-stone-600">No hukka is waiting.</p>}
        {waiting.map((w) => (
          <form key={w.orderItemId} action={startHukkaAction.bind(null, w.orderItemId)} className="card flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {w.quantity > 1 ? `${w.quantity} × ` : ""}
                {w.name}
              </p>
              <p className="text-sm text-stone-600">
                {w.table ?? "No table"} ·{" "}
                <Link href={`/orders/${w.orderId}`} className="underline">
                  order #{w.orderNumber}
                </Link>
              </p>
            </div>
            <label className="text-xs">
              Alert after (min)
              <input name="alert" type="number" min={15} max={240} defaultValue={60} className="ml-1 w-16 rounded border border-stone-300 px-1 py-1 text-sm" />
            </label>
            <button className="min-h-10 rounded-lg bg-teal-700 px-4 font-medium text-white">Start timer</button>
          </form>
        ))}
      </section>

      <section aria-label="Running" className="space-y-2">
        <h2 className="font-semibold">Running ({running.length})</h2>
        {running.length === 0 && <p className="card p-3 text-sm text-stone-600">No hukka is running.</p>}
        {running
          .slice()
          .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
          .map((s) => {
            const elapsed = minutesSince(s.startedAt, now);
            const state = hukkaState(elapsed, s.alertMinutes);
            return (
              <div key={s.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border-2 p-3 ${TONE[state]}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.name} <span className="text-sm font-normal text-stone-600">· {s.tableLabel ?? "No table"}</span>
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">{clockText(elapsed)}</p>
                  <p className="text-xs text-stone-600">
                    {state === "RUNNING_LONG" ? "Running long. " : state === "LATE_SOON" ? "Nearly at the alert time. " : ""}Alert at {s.alertMinutes} min · {s.coils} extra coil{s.coils === 1 ? "" : "s"}
                  </p>
                </div>
                <form action={addCoilAction.bind(null, s.id)}>
                  <button className="min-h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm">+ Extra coil</button>
                </form>
                <form action={finishHukkaAction.bind(null, s.id)}>
                  <button className="min-h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm">Finish</button>
                </form>
              </div>
            );
          })}
      </section>

      <p className="text-sm text-stone-600">
        Last 24 hours: {last24h.started} started, {last24h.finished} finished
        {last24h.averageMinutes !== null ? `, about ${last24h.averageMinutes} min each` : ""}, {last24h.coils} extra coil{last24h.coils === 1 ? "" : "s"}.
      </p>
    </div>
  );
}
