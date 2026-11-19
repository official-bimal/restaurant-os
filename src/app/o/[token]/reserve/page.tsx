import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { lookupReservationBranch } from "@/features/reservations/server/service";
import { MAX_DAYS_AHEAD } from "@/features/reservations/reservations";
import { addDays, localDate } from "@/lib/business-day";
import { db } from "@/server/db";
import { reserveAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reserve a table", referrer: "no-referrer", robots: { index: false, follow: false } };

const field = "mt-1 block w-full rounded-xl border border-white/20 bg-white/10 px-3 py-3 text-base text-white";

export default async function ReservePage({ params, searchParams }: PageProps<"/o/[token]/reserve">) {
  const { token } = await params;
  const sp = await searchParams;
  const branch = await lookupReservationBranch(token);
  if (!branch) notFound();
  const biz = await db.business.findUniqueOrThrow({ where: { id: branch.businessId }, select: { timezone: true } });
  const today = localDate(new Date(), biz.timezone);
  return (
    <main className="guest-dark min-h-screen">
      <div className="mx-auto max-w-lg space-y-4 p-4">
        <h1 className="text-2xl font-semibold">Reserve a table</h1>
        <p className="text-sm opacity-80">
          {branch.businessName}, {branch.branchName}
        </p>
        {typeof sp.error === "string" && (
          <p role="alert" className="rounded-xl bg-red-500/20 px-3 py-2 text-sm">
            {sp.error}
          </p>
        )}
        {!branch.enabled ? (
          <p className="rounded-xl bg-white/10 p-4">We are not taking table requests on this page right now. Please call us.</p>
        ) : (
          <form action={reserveAction.bind(null, token)} className="space-y-3">
            <label className="block text-sm">
              Your name
              <input name="name" required maxLength={60} autoComplete="name" className={field} />
            </label>
            <label className="block text-sm">
              Phone number (we confirm on this number)
              <input name="phone" type="tel" required inputMode="tel" autoComplete="tel" placeholder="98XXXXXXXX" className={field} />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-3 block text-sm sm:col-span-1">
                People
                <input name="partySize" type="number" required min={1} max={20} defaultValue={2} className={field} />
              </label>
              <label className="col-span-3 block text-sm sm:col-span-1">
                Day
                <input name="date" type="date" required min={today} max={addDays(today, MAX_DAYS_AHEAD)} defaultValue={today} className={field} />
              </label>
              <label className="col-span-3 block text-sm sm:col-span-1">
                Time
                <input name="time" type="time" required step={900} defaultValue="19:00" className={field} />
              </label>
            </div>
            <label className="block text-sm">
              Anything we should know (optional)
              <input name="note" maxLength={200} className={field} placeholder="Birthday, high chair, quiet corner…" />
            </label>
            <button className="min-h-12 w-full rounded-xl bg-white px-4 text-base font-semibold text-black">Ask for this table</button>
            <p className="text-xs opacity-70">This is a request. The table is yours once we confirm it by message or call. We hold a table for 15 minutes.</p>
          </form>
        )}
      </div>
    </main>
  );
}
