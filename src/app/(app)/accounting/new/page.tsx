import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { getEasyOptions } from "@/features/accounting/server/easy";
import { EASY_KINDS, TX_LABEL, type EasyKind } from "@/features/accounting/transactions";
import { createEasyEntryAction } from "../easy-actions";
import { ErrorNote, field } from "../ui";

export const dynamic = "force-dynamic";

const HELP: Record<EasyKind, string> = {
  INCOME: "Money you received that is not a sale at the till: a rental, a gift, a refund from a supplier.",
  EXPENSE: "Money you spent: rent, electricity, repairs, marketing.",
  PAYMENT_IN: "A customer paid what they owed you (a credit sale).",
  PAYMENT_OUT: "You paid what you owed (a supplier, a loan).",
  TRANSFER: "Money moved between your own accounts, like cash taken to the bank.",
};

export default async function NewEntryPage({ searchParams }: PageProps<"/accounting/new">) {
  await requireTenant("books.manage");
  const sp = await searchParams;
  const kind = (EASY_KINDS as readonly string[]).includes(String(sp.kind)) ? (String(sp.kind) as EasyKind) : "INCOME";
  const o = await getEasyOptions(await requireTenant("books.manage"));
  const needsOther = kind === "INCOME" || kind === "EXPENSE" || kind === "TRANSFER";
  const otherLabel = kind === "INCOME" ? "Income type" : kind === "EXPENSE" ? "Expense type" : "Moved to";
  const moneyLabel = kind === "INCOME" || kind === "PAYMENT_IN" ? "Received in" : kind === "TRANSFER" ? "Moved from" : "Paid from";
  const partyLabel = kind === "PAYMENT_IN" ? "From (customer)" : kind === "PAYMENT_OUT" ? "To (supplier or person)" : "Who (optional)";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Add an entry</h1>
      <div role="tablist" aria-label="Kind of entry" className="flex flex-wrap gap-2">
        {EASY_KINDS.map((k) => (
          <Link
            key={k}
            href={`/accounting/new?kind=${k}`}
            role="tab"
            aria-selected={k === kind}
            className={`min-h-10 rounded-full px-4 py-2 text-sm font-medium ${k === kind ? "bg-brand-600 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200"}`}
          >
            {TX_LABEL[k]}
          </Link>
        ))}
      </div>
      <ErrorNote error={sp.error} />
      <p className="text-sm text-stone-600">{HELP[kind]} It is saved in the books for you, so you do not have to think in debits and credits.</p>
      <form action={createEasyEntryAction} className="card max-w-xl space-y-3 p-5">
        <input type="hidden" name="kind" value={kind} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Date
            <input type="date" name="date" required defaultValue={o.today} max={o.today} className={field} />
          </label>
          <label className="text-sm">
            Amount (Rs)
            <input name="amount" required inputMode="decimal" className={field} placeholder="1,500" />
          </label>
        </div>
        <label className="block text-sm">
          {moneyLabel}
          <select name="money" required defaultValue={o.money[0]?.id} className={field}>
            {o.money.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {needsOther && (
          <label className="block text-sm">
            {otherLabel}
            <select name="other" required defaultValue="" className={field}>
              <option value="" disabled>
                Choose…
              </option>
              {kind === "INCOME" &&
                o.income.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              {kind === "EXPENSE" &&
                o.expense.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              {kind === "TRANSFER" &&
                o.money.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {kind !== "TRANSFER" && (
          <label className="block text-sm">
            {partyLabel}
            <input name="party" maxLength={80} className={field} />
          </label>
        )}
        <label className="block text-sm">
          Note (optional)
          <input name="note" maxLength={120} className={field} />
        </label>
        <button className="min-h-11 rounded-lg bg-brand-600 px-6 font-medium text-white">Save {TX_LABEL[kind].toLowerCase()}</button>
      </form>
    </div>
  );
}
