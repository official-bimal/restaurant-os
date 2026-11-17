import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { getLoyaltySettings, listCustomers } from "@/features/loyalty/server/customers";
import { formatNpr } from "@/features/billing/calc";
import { setLoyaltySettingsAction } from "./actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

function when(d: Date | null): string {
  if (!d) return "never";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const ctx = await requireTenant("customer.manage");
  const { error, q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const [settings, customers] = await Promise.all([getLoyaltySettings(ctx.businessId), listCustomers(ctx, query)]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Customers and loyalty</h1>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <form action={setLoyaltySettingsAction} className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <h2 className="font-semibold">Points program</h2>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="h-4 w-4" />
          <span>
            <strong>Give points</strong> on every paid bill that has a customer
          </span>
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium">
            Points per Rs 100 spent
            <input name="pointsPer100" type="number" min={0} max={1000} defaultValue={settings.pointsPer100} className={input} />
          </label>
          <label className="text-sm font-medium">
            Points in one reward
            <input name="redeemPoints" type="number" min={1} defaultValue={settings.redeemPoints} className={input} />
          </label>
          <label className="text-sm font-medium">
            One reward takes off (Rs)
            <input
              name="redeemValueRupees"
              type="number"
              min={1}
              step="0.01"
              defaultValue={(settings.redeemValue / 100).toFixed(2)}
              className={input}
            />
          </label>
        </div>
        <p className="mt-2 text-sm text-stone-600">
          Today: {settings.pointsPer100} points per Rs 100, and {settings.redeemPoints} points = {formatNpr(settings.redeemValue)} off, about{" "}
          {settings.redeemPoints > 0 ? ((settings.pointsPer100 * settings.redeemValue) / settings.redeemPoints / 100).toFixed(1) : "0"}% back.
        </p>
        <button className="mt-3 min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Save</button>
      </form>

      <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <form className="mb-3 flex items-end gap-2" method="get">
          <label className="flex-1 text-sm font-medium">
            Find a customer
            <input name="q" defaultValue={query} placeholder="Name or part of the phone number" className={input} />
          </label>
          <button className="min-h-11 rounded-lg border border-stone-300 px-4">Search</button>
        </form>

        {customers.length === 0 ? (
          <p className="text-stone-500">
            {query ? "No one matches." : "No customers yet. Add a customer's phone number on an order and they appear here."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-stone-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 pr-3 font-medium">Points</th>
                  <th className="py-2 pr-3 font-medium">Visits</th>
                  <th className="py-2 pr-3 font-medium">Spent</th>
                  <th className="py-2 pr-3 font-medium">Last visit</th>
                  <th className="py-2 font-medium">Offers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/customers/${c.id}`} className="font-medium underline">
                        {c.name ?? "No name"}
                      </Link>
                      <br />
                      <span className="text-stone-500">{c.phone}</span>
                    </td>
                    <td className="py-2 pr-3">{c.pointsBalance}</td>
                    <td className="py-2 pr-3">{c.visitCount}</td>
                    <td className="py-2 pr-3">{formatNpr(c.totalSpend)}</td>
                    <td className="py-2 pr-3">{when(c.lastVisitAt)}</td>
                    <td className="py-2">
                      {c.marketingConsent ? (c.consentVerified ? "Agreed" : "Agreed (unverified)") : "No"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
