import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { AutoRefresh } from "@/components/auto-refresh";
import { db } from "@/server/db";
import { addDays, isValidDate, localDate } from "@/lib/business-day";
import { confirmationText, declineText, whatsappLink } from "@/features/reservations/reservations";
import { listReservations } from "@/features/reservations/server/service";
import { createReservationAction, reservationStatusAction, reservationsOpenAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";
const TONE = {
  REQUESTED: "bg-amber-100 text-amber-900",
  CONFIRMED: "bg-emerald-100 text-emerald-900",
  SEATED: "bg-sky-100 text-sky-900",
  CANCELLED: "bg-stone-200 text-stone-600",
  NO_SHOW: "bg-rose-100 text-rose-900",
} as const;
const LABEL = { REQUESTED: "Waiting for you", CONFIRMED: "Confirmed", SEATED: "Seated", CANCELLED: "Cancelled", NO_SHOW: "Did not come" } as const;

export default async function ReservationsPage({ searchParams }: PageProps<"/reservations">) {
  const ctx = await requireTenant("order.edit");
  const sp = await searchParams;
  const biz = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const today = localDate(new Date(), biz.timezone);
  const date = typeof sp.date === "string" && isValidDate(sp.date) ? sp.date : today;
  const { rows, tables, enabled, publicToken, businessName } = await listReservations(ctx, date);
  const tableLabel = new Map(tables.map((t) => [t.id, t.label]));
  const owner = can(ctx.role, "branch.manage");
  return (
    <div className="space-y-4">
      <AutoRefresh />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Reservations</h1>
        <Link href={`/reservations?date=${addDays(date, -1)}`} className="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5 text-sm">
          ← Previous
        </Link>
        {date !== today && (
          <Link href="/reservations" className="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5 text-sm">
            Today
          </Link>
        )}
        <Link href={`/reservations?date=${addDays(date, 1)}`} className="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5 text-sm">
          Next →
        </Link>
      </div>
      <p className="text-sm text-stone-600">{date}</p>

      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}
      {sp.sms === "sent" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">A text message was sent to the guest.</p>}
      {sp.sms === "failed" && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">The text message could not be sent{typeof sp.smsError === "string" ? `: ${sp.smsError}` : ""}. Use the WhatsApp or call buttons.</p>}
      {sp.sms === "not-set-up" && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">No text message service is set up, so tell the guest yourself: use the WhatsApp or call buttons on the booking.</p>}

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Guest requests from your page</h2>
        {publicToken ? (
          <p className="text-sm text-stone-600">
            Link to share: <code className="break-all rounded bg-stone-100 px-1">/o/{publicToken}/reserve</code> (add your website address in front). Guests ask for a table here and you confirm it below.
          </p>
        ) : (
          <p className="text-sm text-stone-600">This branch has no public link yet. Set up online ordering first to get one.</p>
        )}
        <p className="text-sm">
          Requests from guests are <strong>{enabled ? "ON" : "OFF"}</strong>.
        </p>
        {owner && (
          <form action={reservationsOpenAction.bind(null, !enabled, date)}>
            <button className="min-h-10 rounded-lg border border-stone-300 px-4 text-sm">{enabled ? "Turn requests off" : "Turn requests on"}</button>
          </form>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">
          Bookings ({rows.filter((r) => r.status !== "CANCELLED").length})
        </h2>
        {rows.length === 0 && <p className="card p-4 text-stone-600">No bookings for this day.</p>}
        {rows.map((r) => {
          const confirm = confirmationText(r, businessName);
          const decline = declineText(r, businessName);
          const open = r.status === "REQUESTED" || r.status === "CONFIRMED";
          return (
            <div key={r.id} className="card space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-semibold tabular-nums">{r.time}</p>
                <p className="font-medium">
                  {r.name} · {r.partySize} {r.partySize === 1 ? "person" : "people"}
                </p>
                <span className={`rounded px-2 py-0.5 text-xs ${TONE[r.status]}`}>{LABEL[r.status]}</span>
                {r.source === "ONLINE" && <span className="rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-900">From the page</span>}
                {r.tableId && <span className="rounded bg-stone-100 px-2 py-0.5 text-xs">Table {tableLabel.get(r.tableId) ?? "?"}</span>}
              </div>
              {r.note && <p className="text-sm text-stone-600">“{r.note}”</p>}
              <div className="flex flex-wrap gap-2 text-sm">
                <a href={`tel:${r.phone}`} className="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5">
                  Call {r.phone}
                </a>
                {open && (
                  <a href={whatsappLink(r.phone, confirm)} target="_blank" rel="noreferrer" className="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5">
                    WhatsApp: confirmation
                  </a>
                )}
                {r.status === "REQUESTED" && (
                  <a href={whatsappLink(r.phone, decline)} target="_blank" rel="noreferrer" className="min-h-9 rounded-lg border border-stone-300 px-3 py-1.5">
                    WhatsApp: sorry, no
                  </a>
                )}
              </div>
              {open && (
                <div className="flex flex-wrap items-end gap-2">
                  {r.status === "REQUESTED" && (
                    <form action={reservationStatusAction.bind(null, r.id, "CONFIRMED", date)} className="flex items-end gap-2">
                      <label className="text-xs">
                        Table
                        <select name="tableId" defaultValue={r.tableId ?? ""} className="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm">
                          <option value="">No table yet</option>
                          {tables.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label} ({t.capacity})
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="min-h-9 rounded-lg bg-teal-700 px-3 text-sm font-medium text-white">Confirm</button>
                    </form>
                  )}
                  {r.status === "CONFIRMED" && (
                    <form action={reservationStatusAction.bind(null, r.id, "SEATED", date)}>
                      <button className="min-h-9 rounded-lg bg-teal-700 px-3 text-sm font-medium text-white">Seated</button>
                    </form>
                  )}
                  {r.status === "CONFIRMED" && (
                    <form action={reservationStatusAction.bind(null, r.id, "NO_SHOW", date)}>
                      <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm">Did not come</button>
                    </form>
                  )}
                  <form action={reservationStatusAction.bind(null, r.id, "CANCELLED", date)}>
                    <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm text-red-700">{r.status === "REQUESTED" ? "Decline" : "Cancel"}</button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <form action={createReservationAction} className="card space-y-3 p-4">
        <h2 className="font-semibold">Add a booking (phone call or walk-in)</h2>
        <input type="hidden" name="date" value={date} />
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm">
            Name
            <input name="name" required maxLength={60} className={field} />
          </label>
          <label className="text-sm">
            Phone
            <input name="phone" type="tel" required className={field} />
          </label>
          <label className="text-sm">
            People
            <input name="partySize" type="number" required min={1} max={20} defaultValue={2} className={field} />
          </label>
          <label className="text-sm">
            Time
            <input name="time" type="time" required defaultValue="19:00" className={field} />
          </label>
          <label className="text-sm">
            Table (optional)
            <select name="tableId" defaultValue="" className={field}>
              <option value="">No table yet</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({t.capacity})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-3">
            Note (optional)
            <input name="note" maxLength={200} className={field} />
          </label>
        </div>
        <button className="min-h-11 rounded-lg bg-teal-700 px-5 font-medium text-white">Add booking for {date}</button>
      </form>
    </div>
  );
}
