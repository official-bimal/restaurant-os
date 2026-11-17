import { getInbox } from "@/features/guest/server/service";
import type { TenantContext } from "@/server/auth";
import { formatNpr } from "@/features/billing/calc";
import { acceptSubmissionAction, completeRequestAction, rejectSubmissionAction } from "./guest-actions";

const KIND_LABEL = { CALL_WAITER: "Call waiter", REQUEST_BILL: "Wants the bill", WATER: "Water" } as const;

function minutesAgo(date: Date): string {
  const m = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  return m === 0 ? "just now" : `${m} min ago`;
}

export async function GuestInbox({ ctx }: { ctx: TenantContext }) {
  const { submissions, requests } = await getInbox(ctx);
  if (submissions.length === 0 && requests.length === 0) return null;

  return (
    <section aria-label="Guest requests" className="space-y-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <h2 className="font-semibold">
        From guests <span className="text-sm font-normal text-stone-600">({submissions.length + requests.length} waiting)</span>
      </h2>

      {requests.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm border border-stone-200 shadow-sm">
              <span>
                <strong>{r.table.label}</strong> · {KIND_LABEL[r.kind]} · {minutesAgo(r.createdAt)}
              </span>
              <form action={completeRequestAction.bind(null, r.id)}>
                <button className="min-h-9 rounded-lg border border-stone-300 px-3 hover:bg-stone-50">Done</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {submissions.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {submissions.map((s) => {
            const total = s.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
            return (
              <li key={s.id} className="rounded-lg bg-white p-3 border border-stone-200 shadow-sm">
                <div className="flex justify-between text-sm">
                  <strong>{s.table.label} · new order</strong>
                  <span className="text-stone-500">{minutesAgo(s.createdAt)}</span>
                </div>
                <ul className="my-2 text-sm">
                  {s.items.map((i) => (
                    <li key={i.id}>
                      {i.quantity} × {i.name}
                      {i.addOnNames.length > 0 && <span className="font-medium text-orange-700"> · {i.addOnNames.join(" · ")}</span>}
                      {i.note && <span className="text-stone-500"> ({i.note})</span>}
                    </li>
                  ))}
                </ul>
                {s.note && <p className="mb-2 text-sm text-stone-600">Note: {s.note}</p>}
                <p className="mb-2 text-xs text-stone-500">{formatNpr(total)} before charges</p>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={acceptSubmissionAction.bind(null, s.id)}>
                    <button className="min-h-11 rounded-lg bg-green-700 px-4 font-medium text-white">Accept</button>
                  </form>
                  <form action={rejectSubmissionAction.bind(null, s.id)} className="flex items-center gap-1">
                    <select name="reason" aria-label="Reason" className="min-h-11 rounded-lg border border-stone-300 px-2 text-sm">
                      <option value="Sorry, we cannot prepare this right now.">Reject: cannot prepare</option>
                      <option value="Sorry, one of the dishes is finished.">Reject: dish finished</option>
                      <option value="The kitchen is closed.">Reject: kitchen closed</option>
                    </select>
                    <button className="min-h-11 rounded-lg border border-red-300 px-3 text-sm text-red-700">Reject</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
