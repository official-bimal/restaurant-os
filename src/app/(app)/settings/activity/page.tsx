import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { db } from "@/server/db";
import { addDays, isValidDate, localDate } from "@/lib/business-day";
import { getActivity } from "@/features/business/server/activity";

export const dynamic = "force-dynamic";

const field = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

export default async function ActivityPage({ searchParams }: PageProps<"/settings/activity">) {
  const ctx = await requireTenant("owner.control");
  const sp = await searchParams;
  const biz = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const today = localDate(new Date(), biz.timezone);
  const f = typeof sp.from === "string" && isValidDate(sp.from) ? sp.from : addDays(today, -6);
  const t = typeof sp.to === "string" && isValidDate(sp.to) ? sp.to : today;
  const from = f <= t ? f : t;
  const to = f <= t ? t : f;
  const userId = typeof sp.user === "string" && sp.user ? sp.user : undefined;
  const search = typeof sp.q === "string" ? sp.q : "";
  const a = await getActivity(ctx, { from, to, userId, search });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-sm text-stone-500 hover:underline">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold">Activity log</h1>
      </div>
      <form className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          From
          <input type="date" name="from" defaultValue={from} className={field} />
        </label>
        <label className="text-sm">
          To
          <input type="date" name="to" defaultValue={to} className={field} />
        </label>
        <label className="text-sm">
          Who
          <select name="user" defaultValue={userId ?? ""} className={field}>
            <option value="">Everyone</option>
            {a.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Search
          <input name="q" defaultValue={search} maxLength={40} placeholder="refund, menu, void…" className={field} />
        </label>
        <button className="min-h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white">Show</button>
      </form>
      <section className="card overflow-x-auto p-0">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
              <th className="px-4 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">Who</th>
              <th className="px-3 py-2 font-semibold">What</th>
              <th className="px-3 py-2 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody>
            {a.events.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-stone-500">
                  Nothing in this period.
                </td>
              </tr>
            )}
            {a.events.map((e) => (
              <tr key={e.id} className="border-b border-stone-100 align-top">
                <td className="px-4 py-2 whitespace-nowrap">{e.at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: biz.timezone })}</td>
                <td className="px-3 py-2">{e.who}</td>
                <td className="px-3 py-2">
                  {e.what}
                  <span className="block text-xs text-stone-400">{e.code}</span>
                </td>
                <td className="px-3 py-2 break-words text-xs text-stone-600">{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {a.events.length === 300 && <p className="text-xs text-stone-500">Showing the latest 300. Choose a shorter period to see the rest.</p>}
    </div>
  );
}
