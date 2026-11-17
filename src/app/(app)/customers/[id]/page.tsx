import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/server/auth";
import { getCustomer } from "@/features/loyalty/server/customers";
import { DomainError } from "@/server/errors";
import { formatNpr } from "@/features/billing/calc";
import { CustomerOsPoints } from "@/features/customeros/points";
import { adjustPointsAction, deleteCustomerAction, setBirthdayAction, updateCustomerAction } from "../actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";
const KIND = { EARN: "Earned", REDEEM: "Spent", ADJUST: "Adjusted", REVERSAL: "Refund" } as const;

export default async function CustomerPage({ params, searchParams }: PageProps<"/customers/[id]">) {
  const ctx = await requireTenant("customer.manage");
  const { id } = await params;
  const { error } = await searchParams;
  let customer;
  try {
    customer = await getCustomer(ctx, id);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/customers" className="text-sm text-stone-500 hover:underline">
          ← Customers
        </Link>
        <h1 className="text-xl font-semibold">{customer.name ?? "No name"}</h1>
        <span className="text-stone-500">{customer.phone}</span>
      </div>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <CustomerOsPoints ctx={ctx} customerId={customer.id} className="text-sm" />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Points", String(customer.pointsBalance)],
          ["Visits", String(customer.visitCount)],
          ["Spent", formatNpr(customer.totalSpend)],
          ["First seen", customer.firstSeenAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-white p-3 border border-stone-200 shadow-sm">
            <dt className="text-xs text-stone-500">{k}</dt>
            <dd className="text-lg font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 md:grid-cols-2">
        <form action={updateCustomerAction.bind(null, customer.id)} className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <h2 className="font-semibold">Details</h2>
          <label className="mt-2 block text-sm font-medium">
            Name
            <input name="name" maxLength={80} defaultValue={customer.name ?? ""} className={input} />
          </label>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" name="consent" defaultChecked={customer.marketingConsent} className="mt-1 h-4 w-4" />
            <span>
              Agrees to receive offers by message.
              {customer.marketingConsent && !customer.consentVerified && (
                <em className="block text-amber-700">Ticked by the guest on their phone and not yet verified. Saving here confirms it.</em>
              )}
            </span>
          </label>
          <button className="mt-3 min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Save</button>
        </form>

        <form action={setBirthdayAction.bind(null, customer.id)} className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <h2 className="font-semibold">Birthday</h2>
          <p className="text-sm text-stone-500">Month and day only, no year. Used for the automatic birthday offer. Leave both empty to clear.</p>
          <div className="mt-2 flex gap-3">
            <label className="flex-1 text-sm font-medium">
              Month
              <select name="month" defaultValue={customer.birthMonth ?? ""} className={input}>
                <option value="">Not set</option>
                {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-24 text-sm font-medium">
              Day
              <input name="day" type="number" min={1} max={31} defaultValue={customer.birthDay ?? ""} className={input} />
            </label>
          </div>
          <button className="mt-3 min-h-11 rounded-lg border border-stone-300 px-4 font-medium">Save birthday</button>
        </form>

        <form action={adjustPointsAction.bind(null, customer.id)} className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <h2 className="font-semibold">Adjust points</h2>
          <p className="text-sm text-stone-500">For goodwill or to fix a mistake. Recorded with your name.</p>
          <label className="mt-2 block text-sm font-medium">
            Points (use a minus to take away)
            <input name="points" type="number" step={1} required className={input} />
          </label>
          <label className="mt-2 block text-sm font-medium">
            Reason
            <input name="reason" required minLength={3} maxLength={200} className={input} />
          </label>
          <button className="mt-3 min-h-11 rounded-lg border border-stone-300 px-4 font-medium">Adjust</button>
        </form>
      </div>

      <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <h2 className="mb-2 font-semibold">Points history</h2>
        {customer.entries.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {customer.entries.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2">
                <span className="w-32 text-stone-500">
                  {e.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
                <span className="flex-1">
                  {KIND[e.kind]}
                  {e.note ? `: ${e.note}` : ""}
                </span>
                <span className={e.points < 0 ? "text-red-700" : "text-green-800"}>
                  {e.points > 0 ? "+" : ""}
                  {e.points}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <summary className="cursor-pointer text-sm font-medium text-red-700">Erase this customer</summary>
        <form action={deleteCustomerAction.bind(null, customer.id)} className="mt-3 rounded-lg bg-red-50 p-3 text-sm">
          <p>
            Deletes their name, phone number and points history. Past bills keep their amounts but are no longer linked to
            them. This cannot be undone.
          </p>
          <button className="mt-2 min-h-9 rounded-lg bg-red-700 px-3 text-white">Yes, erase</button>
        </form>
      </details>
    </div>
  );
}
