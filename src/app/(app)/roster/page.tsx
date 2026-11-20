import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { db } from "@/server/db";
import { addDays, isValidDate, localDate } from "@/lib/business-day";
import { weekStartOf } from "@/features/roster/roster";
import { getRosterWeek, myShifts } from "@/features/roster/server/service";
import { addShiftAction, copyWeekAction, removeShiftAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "mt-1 block w-full rounded-lg border border-stone-300 px-2 py-2 text-base";
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}m` : ""}`;

export default async function RosterPage({ searchParams }: PageProps<"/roster">) {
  const ctx = await requireTenant();
  const sp = await searchParams;
  const biz = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const today = localDate(new Date(), biz.timezone);
  const week = weekStartOf(typeof sp.week === "string" && isValidDate(sp.week) ? sp.week : today);
  const error = typeof sp.error === "string" ? sp.error : null;

  // Everyone can see their own shifts; managers see and change the whole week.
  if (!can(ctx, "time.manage")) {
    const mine = await myShifts(ctx, today, 14);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">My shifts</h1>
        {mine.length === 0 ? (
          <p className="card p-5 text-stone-600">You have no shifts on the roster for the next two weeks.</p>
        ) : (
          <ul className="card divide-y divide-stone-100">
            {mine.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 p-4">
                <span className="font-medium">
                  {DAY[new Date(`${s.date}T00:00:00Z`).getUTCDay()]} {s.date}
                </span>
                <span className="tabular-nums">
                  {s.startTime} to {s.endTime}
                </span>
                {s.note && <span className="text-sm text-stone-500">{s.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const w = await getRosterWeek(ctx, week);
  const prev = addDays(week, -7);
  const next = addDays(week, 7);
  const byUserDay = (uid: string, d: string) => w.shifts.filter((s) => s.userId === uid && s.date === d);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Roster</h1>
        <Link href={`/roster?week=${prev}`} className="btn-secondary">
          ← Previous week
        </Link>
        {week !== weekStartOf(today) && (
          <Link href="/roster" className="btn-secondary">
            This week
          </Link>
        )}
        <Link href={`/roster?week=${next}`} className="btn-secondary">
          Next week →
        </Link>
      </div>
      <p className="text-sm text-stone-600">
        Week of {week} to {w.days[6]}. Weeks run Sunday to Saturday. Staff see their own shifts when they open this page.
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <section className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
              <th className="px-4 py-3 font-semibold">Staff</th>
              {w.days.map((d, i) => (
                <th key={d} className={`px-2 py-3 font-semibold ${d === today ? "text-brand-700" : ""}`}>
                  {DAY[i]} <span className="block text-xs font-normal">{d.slice(5)}</span>
                </th>
              ))}
              <th className="px-3 py-3 text-right font-semibold">Hours</th>
            </tr>
          </thead>
          <tbody>
            {w.staff.map((s) => (
              <tr key={s.userId} className="border-b border-stone-100 align-top">
                <td className="px-4 py-2 font-medium">
                  {s.name}
                  <span className="block text-xs font-normal text-stone-500">{s.role.toLowerCase()}</span>
                </td>
                {w.days.map((d) => (
                  <td key={d} className="px-2 py-2">
                    {byUserDay(s.userId, d).map((x) => (
                      <form key={x.id} action={removeShiftAction.bind(null, week, x.id)} className="mb-1">
                        <span className="block rounded-md bg-brand-50 px-1.5 py-1 text-xs text-brand-700">
                          {x.startTime}-{x.endTime}
                          {x.note ? ` ${x.note}` : ""}
                          <button aria-label={`Remove ${s.name}'s shift on ${d}`} className="ml-1 text-stone-400 hover:text-red-700">
                            ×
                          </button>
                        </span>
                      </form>
                    ))}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">{w.minutes[s.userId] ? hm(w.minutes[s.userId]!) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <form action={addShiftAction.bind(null, week)} className="card flex flex-wrap items-end gap-3 p-4">
        <h2 className="w-full font-semibold">Add a shift</h2>
        <label className="text-sm">
          Who
          <select name="userId" required defaultValue="" className={field}>
            <option value="" disabled>
              Choose…
            </option>
            {w.staff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Day
          <select name="date" className={field} defaultValue={w.days.includes(today) ? today : w.days[1]}>
            {w.days.map((d, i) => (
              <option key={d} value={d}>
                {DAY[i]} {d}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          From
          <input type="time" name="start" required defaultValue="09:00" className={field} />
        </label>
        <label className="text-sm">
          To
          <input type="time" name="end" required defaultValue="17:00" className={field} />
        </label>
        <label className="text-sm">
          Note
          <input name="note" maxLength={80} placeholder="Opening, bar…" className={field} />
        </label>
        <button className="min-h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white">Add shift</button>
        <p className="w-full text-xs text-stone-500">A shift that ends earlier than it starts runs past midnight. A person cannot have two shifts that overlap.</p>
      </form>

      <form action={copyWeekAction.bind(null, prev, week)} className="flex flex-wrap items-center gap-3 text-sm">
        <button className="btn-secondary">Copy last week&apos;s shifts into this week</button>
        <span className="text-xs text-stone-500">Shifts that would clash with what is already here are skipped.</span>
      </form>
      <p className="text-xs text-stone-500">Hours total {hm(Object.values(w.minutes).reduce((n, v) => n + v, 0))} this week. Time worked for payroll still comes from the time clock; the roster is the plan.</p>
    </div>
  );
}
