import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { db } from "@/server/db";
import { formatNpr } from "@/features/billing/calc";
import { localDate } from "@/lib/business-day";
import { getPayables, listBills } from "@/features/purchasing/server/bills";
import { listSuppliers } from "@/features/purchasing/server/service";
import { createBillAction, payBillAction, voidBillAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "min-h-10 px-3 text-sm";
const small = "min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50";
const STATUS = {
  UNPAID: "bg-amber-100 text-amber-900",
  PARTIAL: "bg-blue-100 text-blue-900",
  PAID: "bg-emerald-100 text-emerald-900",
  VOID: "bg-stone-200 text-stone-600",
} as const;
const METHOD = { CASH: "Cash", BANK: "Bank transfer", QR: "QR", CHEQUE: "Cheque", OTHER: "Other" } as const;

export default async function BillsPage({ searchParams }: PageProps<"/stock/bills">) {
  const ctx = await requireTenant("supplier.pay");
  const { error, show } = await searchParams;
  const [bills, payables, suppliers, business] = await Promise.all([
    listBills(ctx),
    getPayables(ctx),
    listSuppliers(ctx),
    db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } }),
  ]);
  const today = localDate(new Date(), business.timezone);
  const shown = show === "all" ? bills : bills.filter((b) => b.outstanding > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Supplier bills</h1>
          <p className="text-sm text-stone-500">What suppliers are owed, and what has been paid. Payments are never edited; a wrong bill is voided.</p>
        </div>
        <Link href="/stock/orders" className={`${small} flex items-center`}>
          Purchase orders
        </Link>
      </div>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-amber-50 p-4 text-amber-900">
          <p className="text-xs font-medium opacity-80">Owed to suppliers</p>
          <p className="mt-1 text-2xl font-semibold">{formatNpr(payables.totals.outstanding)}</p>
        </div>
        <div className="rounded-2xl bg-red-50 p-4 text-red-900">
          <p className="text-xs font-medium opacity-80">Overdue</p>
          <p className="mt-1 text-2xl font-semibold">{formatNpr(payables.totals.overdue)}</p>
        </div>
      </section>

      {payables.rows.length > 0 && (
        <section className="card overflow-x-auto p-4">
          <h2 className="mb-2 font-semibold">By supplier</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Supplier</th>
                <th className="py-2 pr-3 text-right font-medium">Owed</th>
                <th className="py-2 pr-3 text-right font-medium">Not yet due</th>
                <th className="py-2 pr-3 text-right font-medium">1 to 30 days late</th>
                <th className="py-2 pr-3 text-right font-medium">31 to 60</th>
                <th className="py-2 text-right font-medium">Over 60</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {payables.rows.map((r) => (
                <tr key={r.supplierId}>
                  <td className="py-2 pr-3 font-medium">{r.supplier}</td>
                  <td className="py-2 pr-3 text-right">{formatNpr(r.outstanding)}</td>
                  <td className="py-2 pr-3 text-right">{formatNpr(r.buckets.NOT_DUE)}</td>
                  <td className="py-2 pr-3 text-right">{formatNpr(r.buckets.DAYS_1_30)}</td>
                  <td className="py-2 pr-3 text-right">{formatNpr(r.buckets.DAYS_31_60)}</td>
                  <td className="py-2 text-right text-red-700">{formatNpr(r.buckets.OVER_60)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <details className="card p-4" open={bills.length === 0}>
        <summary className="cursor-pointer font-semibold">Enter a bill</summary>
        {suppliers.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Add a supplier first (Purchase orders → Suppliers).</p>
        ) : (
          <form action={createBillAction} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium">
              Supplier
              <select name="supplierId" required className={`mt-1 block ${field}`}>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Their invoice no.
              <input name="number" maxLength={60} className={`mt-1 block w-36 ${field}`} />
            </label>
            <label className="text-sm font-medium">
              Bill date
              <input name="billDate" type="date" required defaultValue={today} className={`mt-1 block ${field}`} />
            </label>
            <label className="text-sm font-medium">
              Due date
              <input name="dueDate" type="date" className={`mt-1 block ${field}`} />
            </label>
            <label className="text-sm font-medium">
              Amount (Rs)
              <input name="amount" type="number" min={0.01} step="0.01" required className={`mt-1 block w-32 ${field}`} />
            </label>
            <label className="text-sm font-medium">
              VAT inside it (Rs)
              <input name="vatAmount" type="number" min={0} step="0.01" className={`mt-1 block w-28 ${field}`} />
            </label>
            <label className="text-sm font-medium">
              TDS kept back (Rs)
              <input name="tdsAmount" type="number" min={0} step="0.01" className={`mt-1 block w-28 ${field}`} />
            </label>
            <label className="text-sm font-medium">
              Note
              <input name="note" maxLength={300} className={`mt-1 block w-52 ${field}`} />
            </label>
            <button className="btn-primary">Save bill</button>
          </form>
        )}
      </details>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{show === "all" ? "All bills" : "Open bills"}</h2>
          <Link href={show === "all" ? "/stock/bills" : "/stock/bills?show=all"} className="text-sm text-brand-700 underline">
            {show === "all" ? "Show only unpaid" : "Show paid and voided too"}
          </Link>
        </div>
        {shown.length === 0 && <p className="text-sm text-stone-500">Nothing here.</p>}
        {shown.map((b) => (
          <article key={b.id} className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">
                  {b.supplier.name} {b.number && <span className="text-stone-500">· #{b.number}</span>}
                </p>
                <p className="text-xs text-stone-500">
                  Dated {b.billDate}
                  {b.dueDate ? ` · due ${b.dueDate}` : ""}
                  {b.note ? ` · ${b.note}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {b.overdue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">Overdue</span>}
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[b.status]}`}>{b.status.toLowerCase()}</span>
                <span className="font-semibold">{formatNpr(b.amount)}</span>
                {b.status !== "VOID" && <span className="text-stone-500">({formatNpr(b.outstanding)} left)</span>}
              </div>
            </div>

            {b.payments.length > 0 && (
              <ul className="divide-y divide-stone-100 text-sm">
                {b.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                    <span>
                      Paid {formatNpr(p.amount)} by {METHOD[p.method]}
                      {p.reference && <span className="text-stone-500"> · {p.reference}</span>}
                      {p.note && <span className="text-stone-500"> · {p.note}</span>}
                    </span>
                    <span className="text-stone-500">{p.paidOn}</span>
                  </li>
                ))}
              </ul>
            )}
            {b.voidedAt && <p className="text-sm text-stone-500">Voided: {b.voidReason}</p>}

            {b.outstanding > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">Record a payment</summary>
                <form action={payBillAction.bind(null, b.id)} className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="text-xs font-medium text-stone-600">
                    Amount (Rs)
                    <input name="amount" type="number" min={0.01} step="0.01" max={b.outstanding / 100} defaultValue={b.outstanding / 100} required className={`mt-1 block w-32 ${field}`} />
                  </label>
                  <label className="text-xs font-medium text-stone-600">
                    How
                    <select name="method" className={`mt-1 block ${field}`}>
                      {Object.entries(METHOD).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-stone-600">
                    Date
                    <input name="paidOn" type="date" required defaultValue={today} className={`mt-1 block ${field}`} />
                  </label>
                  <label className="text-xs font-medium text-stone-600">
                    Reference
                    <input name="reference" maxLength={80} placeholder="Cheque no. etc." className={`mt-1 block w-36 ${field}`} />
                  </label>
                  <button className="btn-primary">Record</button>
                </form>
              </details>
            )}
            {!b.voidedAt && b.payments.length === 0 && (
              <details>
                <summary className="cursor-pointer text-xs text-red-700">Void this bill</summary>
                <form action={voidBillAction.bind(null, b.id)} className="mt-2 flex gap-2">
                  <input name="reason" required minLength={3} maxLength={200} placeholder="Why" aria-label="Reason" className={`w-64 ${field}`} />
                  <button className={`${small} text-red-700`}>Void</button>
                </form>
              </details>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
