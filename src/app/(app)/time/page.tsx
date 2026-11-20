import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { db } from "@/server/db";
import { localDate } from "@/lib/business-day";
import { formatHours, isPeriod, minutesBetween, toLocalInput } from "@/features/payroll/payroll";
import { getClockSettings, listTeam, listTimeEntries, myClock, whoIsIn } from "@/features/payroll/server/time";
import { addEntryAction, editEntryAction, removeEntryAction, saveClockSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "min-h-9 px-2 text-sm";
const small = "min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50";

export default async function TimePage({ searchParams }: PageProps<"/time">) {
  const ctx = await requireTenant();
  const q = await searchParams;
  const business = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const tz = business.timezone;
  const thisMonth = localDate(new Date(), tz).slice(0, 7);
  const period = typeof q.period === "string" && isPeriod(q.period) ? q.period : thisMonth;
  const manage = can(ctx, "time.manage");
  const team = manage ? await listTeam(ctx) : [];
  const requested = typeof q.user === "string" && q.user ? q.user : ctx.userId;
  const userId = manage && team.some((t) => t.userId === requested) ? requested : ctx.userId;
  const viewingName = team.find((t) => t.userId === userId)?.name;

  const [entries, clock, inNow] = await Promise.all([listTimeEntries(ctx, { period, userId }), myClock(ctx), manage ? whoIsIn(ctx) : Promise.resolve([])]);
  const clockSettings = manage ? await getClockSettings(ctx) : null;
  const total = entries.reduce((n, e) => n + (e.clockOut ? minutesBetween(e.clockIn, e.clockOut) : 0), 0);
  const fmt = (d: Date) => d.toLocaleString("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const error = typeof q.error === "string" ? q.error : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Time</h1>
          <p className="text-sm text-stone-500">
            {clock.since
              ? `You are clocked in since ${clock.since.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}. Clock out from the sidebar.`
              : "You are not clocked in. Clock in from the sidebar."}
          </p>
        </div>
        <form className="flex flex-wrap items-end gap-2" method="get">
          {manage && (
            <label className="text-sm font-medium">
              Person
              <select name="user" defaultValue={userId} className={`mt-1 block ${field}`}>
                {team.map((t) => (
                  <option key={t.userId} value={t.userId}>
                    {t.name}
                    {t.userId === ctx.userId ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-sm font-medium">
            Month
            <input name="period" type="month" defaultValue={period} className={`mt-1 block ${field}`} />
          </label>
          <button className={small}>Show</button>
        </form>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {manage && clockSettings && (
        <form action={saveClockSettingsAction} className="card space-y-3 p-4">
          <h2 className="font-semibold">Clocking in by location</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="requireLocation" defaultChecked={clockSettings.requireLocation} className="mt-1 h-4 w-4" />
            <span>
              <strong>Staff must be at the cafe to clock in.</strong> The phone&apos;s location is read only at the moment they tap Clock in, and only the distance from
              the cafe is kept, never where they were. Clocking out is always allowed, but you are told if someone clocks out away from the cafe.
            </span>
          </label>
          <label className="block text-sm font-medium">
            How close counts as at {clockSettings.branchName} (metres)
            <input name="radius" type="number" min={30} max={1000} defaultValue={clockSettings.radius} className="mt-1 block w-32 px-3 py-2" />
          </label>
          {!clockSettings.hasLocation && (
            <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{clockSettings.branchName} has no location yet. Set it on the Branches page before switching this on.</p>
          )}
          <p className="text-xs text-stone-500">
            Phones only share their location on a secure (https) connection. A phone can also be made to report a false location, so this stops casual clocking in
            from home but is not proof against someone determined to cheat.
          </p>
          <button className="min-h-10 rounded-lg bg-brand-600 px-4 font-medium text-white hover:bg-brand-700">Save</button>
        </form>
      )}

      {manage && inNow.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Clocked in now</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {inNow.map((p) => (
              <li key={p.id} className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">
                {p.name} · since {p.since.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{viewingName && userId !== ctx.userId ? `${viewingName}'s hours` : "Your hours"}</h2>
          <span className="text-sm text-stone-600">
            {entries.length} shift{entries.length === 1 ? "" : "s"} · {formatHours(total)}
          </span>
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-stone-500">No time recorded this month.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {entries.map((e) => (
              <li key={e.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {fmt(e.clockIn)} to {e.clockOut ? fmt(e.clockOut) : <strong className="text-emerald-700">still clocked in</strong>}
                    {e.source === "MANUAL" && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs">entered by a manager</span>}
                    {e.note && <span className="text-stone-500"> · {e.note}</span>}
                  </span>
                  <span className="font-medium">{e.clockOut ? formatHours(minutesBetween(e.clockIn, e.clockOut)) : ""}</span>
                </div>
                {manage && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-stone-500">Correct</summary>
                    <form action={editEntryAction.bind(null, e.id)} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="user" value={userId} />
                      <input type="hidden" name="period" value={period} />
                      <label className="text-xs font-medium text-stone-600">
                        In
                        <input name="clockIn" type="datetime-local" required defaultValue={toLocalInput(e.clockIn, tz)} className={`mt-1 block ${field}`} />
                      </label>
                      <label className="text-xs font-medium text-stone-600">
                        Out
                        <input name="clockOut" type="datetime-local" defaultValue={e.clockOut ? toLocalInput(e.clockOut, tz) : ""} className={`mt-1 block ${field}`} />
                      </label>
                      <input name="note" defaultValue={e.note ?? ""} placeholder="Note" maxLength={200} aria-label="Note" className={`w-40 ${field}`} />
                      <button className={small}>Save</button>
                    </form>
                    <form action={removeEntryAction.bind(null, e.id)} className="mt-1 flex items-end gap-2">
                      <input type="hidden" name="user" value={userId} />
                      <input type="hidden" name="period" value={period} />
                      <input name="reason" required minLength={3} maxLength={200} placeholder="Why remove it" aria-label="Reason" className={`w-48 ${field}`} />
                      <button className="text-xs text-red-700 underline">Remove</button>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {manage && (
        <details className="card p-4">
          <summary className="cursor-pointer font-semibold">Add a shift someone forgot to clock</summary>
          <form action={addEntryAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="period" value={period} />
            <label className="text-sm font-medium">
              Person
              <select name="userId" defaultValue={userId} className={`mt-1 block ${field}`}>
                {team.map((t) => (
                  <option key={t.userId} value={t.userId}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              In
              <input name="clockIn" type="datetime-local" required className={`mt-1 block ${field}`} />
            </label>
            <label className="text-sm font-medium">
              Out
              <input name="clockOut" type="datetime-local" required className={`mt-1 block ${field}`} />
            </label>
            <label className="text-sm font-medium">
              Note
              <input name="note" maxLength={200} className={`mt-1 block w-48 ${field}`} />
            </label>
            <button className="btn-primary">Add</button>
          </form>
          <p className="mt-2 text-xs text-stone-500">Times are in your business time zone ({tz}). Months already in a finalized payroll are locked.</p>
        </details>
      )}
    </div>
  );
}
