import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { db } from "@/server/db";
import { addDays, isValidDate, localDate } from "@/lib/business-day";
import { formatHours } from "@/features/payroll/payroll";
import { getAttendance } from "@/features/payroll/server/time";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

const STATUS = {
  IN: { label: "In now", tone: "bg-emerald-100 text-emerald-900" },
  DONE: { label: "Worked", tone: "bg-sky-100 text-sky-900" },
  OFF: { label: "Off / not in", tone: "bg-stone-200 text-stone-700" },
} as const;

export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const ctx = await requireTenant("time.manage");
  const q = await searchParams;
  const { timezone } = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const today = localDate(new Date(), timezone);
  const date = typeof q.date === "string" && isValidDate(q.date) && q.date <= today ? q.date : today;
  const { rows, counts } = await getAttendance(ctx, date);
  const t = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
  const pretty = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const off = rows.filter((r) => r.status === "OFF");

  return (
    <div className="space-y-5">
      {date === today && <AutoRefresh />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Attendance</h1>
          <p className="text-sm text-stone-500">{pretty}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/attendance?date=${addDays(date, -1)}`} className="min-h-10 rounded-lg border border-stone-300 px-3 py-2">
            ← Previous day
          </Link>
          {date !== today && (
            <>
              <Link href={`/attendance?date=${addDays(date, 1)}`} className="min-h-10 rounded-lg border border-stone-300 px-3 py-2">
                Next day →
              </Link>
              <Link href="/attendance" className="min-h-10 rounded-lg bg-brand-600 px-3 py-2 text-white">
                Today
              </Link>
            </>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        {[
          ["In now", counts.in, "text-emerald-700"],
          ["Came and left", counts.done, "text-sky-700"],
          ["Off / not in", counts.off, "text-stone-600"],
        ].map(([k, v, tone]) => (
          <div key={String(k)} className="card p-3">
            <dt className="text-xs text-stone-500">{k}</dt>
            <dd className={`text-2xl font-semibold ${tone}`}>{v}</dd>
          </div>
        ))}
      </dl>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Who came</h2>
        {rows.filter((r) => r.status !== "OFF").length === 0 ? (
          <p className="text-sm text-stone-500">Nobody clocked in on this day.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {rows
              .filter((r) => r.status !== "OFF")
              .map((r) => (
                <li key={r.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="min-w-0 flex-1 font-medium">
                    {r.name} <span className="text-xs font-normal text-stone-500">{r.role.toLowerCase()}</span>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
                  <span className="text-stone-600">
                    {r.firstIn ? t(r.firstIn) : ""}
                    {r.status === "DONE" && r.lastOut ? ` to ${t(r.lastOut)}` : ""}
                  </span>
                  <span className="w-20 text-right font-medium">{formatHours(r.minutes)}</span>
                  {r.shifts > 1 && <span className="text-xs text-stone-500">{r.shifts} shifts</span>}
                  {r.awayOut && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">clocked out away from the cafe</span>}
                  {r.inDistanceM !== null && <span className="text-xs text-stone-500">{r.inDistanceM} m from the cafe at clock in</span>}
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Off / not in ({off.length})</h2>
        {off.length === 0 ? (
          <p className="text-sm text-stone-500">Everyone clocked in.</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {off.map((r) => (
              <li key={r.userId} className="rounded-full bg-stone-100 px-3 py-1">
                {r.name}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-stone-500">Anyone with no time recorded that day is listed as off. There is no shift schedule yet, so this cannot tell a day off from a missed clock in.</p>
      </section>
    </div>
  );
}
