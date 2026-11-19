import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getReservationByToken } from "@/features/reservations/server/service";
import { AutoRefresh } from "@/components/auto-refresh";
import { cancelReservationAction } from "../actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your booking", referrer: "no-referrer", robots: { index: false, follow: false } };

const TEXT = {
  REQUESTED: "We got your request. We will confirm it by message or call.",
  CONFIRMED: "Your table is confirmed. We hold it for 15 minutes after the time.",
  SEATED: "Welcome! You have been seated.",
  CANCELLED: "This booking is cancelled.",
  NO_SHOW: "This booking was marked as not arrived.",
} as const;

export default async function BookingStatusPage({ params, searchParams }: PageProps<"/o/[token]/reserve/[code]">) {
  const { token, code } = await params;
  const sp = await searchParams;
  const r = await getReservationByToken(code);
  if (!r) notFound();
  const canCancel = r.status === "REQUESTED" || r.status === "CONFIRMED";
  return (
    <main className="guest-dark min-h-screen">
      <div className="mx-auto max-w-lg space-y-4 p-4">
        <AutoRefresh live={false} everyMs={20000} />
        <h1 className="text-2xl font-semibold">Your booking</h1>
        <div className="rounded-2xl bg-white/10 p-4">
          <p className="text-lg font-medium">{r.businessName}</p>
          <p>
            {r.partySize} {r.partySize === 1 ? "person" : "people"} · {r.date} at {r.time}
          </p>
          <p className="mt-2 text-sm opacity-90">{TEXT[r.status]}</p>
        </div>
        {typeof sp.error === "string" && (
          <p role="alert" className="rounded-xl bg-red-500/20 px-3 py-2 text-sm">
            {sp.error}
          </p>
        )}
        {canCancel && (
          <form action={cancelReservationAction.bind(null, token, code)}>
            <button className="min-h-11 rounded-xl border border-white/30 px-4">Cancel this booking</button>
          </form>
        )}
        <p className="text-xs opacity-70">Keep this page to check on your booking. Anyone with this link can see it, so do not share it.</p>
      </div>
    </main>
  );
}
