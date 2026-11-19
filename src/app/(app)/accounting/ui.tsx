import Link from "next/link";
import { isValidDate } from "@/lib/business-day";
import { bsText } from "@/features/accounting/fiscal";
import { formatNpr } from "@/features/billing/calc";

export const field = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

const TABS = [
  { href: "/accounting", label: "Overview" },
  { href: "/accounting/daybook", label: "Daybook" },
  { href: "/accounting/voucher", label: "New voucher" },
  { href: "/accounting/ledger", label: "Ledger" },
  { href: "/accounting/trial-balance", label: "Trial balance" },
  { href: "/accounting/profit-loss", label: "Profit and loss" },
  { href: "/accounting/balance-sheet", label: "Balance sheet" },
  { href: "/accounting/accounts", label: "Chart of accounts" },
  { href: "/accounting/sales-book", label: "Sales book" },
  { href: "/accounting/purchase-book", label: "Purchase book" },
  { href: "/accounting/vat", label: "VAT summary" },
  { href: "/accounting/audit-log", label: "Audit log" },
];

export function AccountingTabs({ current }: { current: string }) {
  return (
    <nav aria-label="Accounting" className="flex gap-1 overflow-x-auto pb-1">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={`min-h-9 shrink-0 rounded-lg px-3 py-1.5 text-sm ${t.href === current ? "bg-teal-700 text-white" : "border border-stone-300 text-stone-700"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** A date range chosen on the page (GET form), falling back to the given defaults. */
export function pickRange(sp: Record<string, string | string[] | undefined>, def: { from: string; to: string }) {
  const f = typeof sp.from === "string" && isValidDate(sp.from) ? sp.from : def.from;
  const t = typeof sp.to === "string" && isValidDate(sp.to) ? sp.to : def.to;
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

export function RangeForm({ from, to, extra, single }: { from: string; to: string; extra?: React.ReactNode; single?: boolean }) {
  return (
    <form className="flex flex-wrap items-end gap-3">
      {extra}
      {!single && (
        <label className="text-sm">
          From
          <input type="date" name="from" defaultValue={from} className={field} />
        </label>
      )}
      <label className="text-sm">
        {single ? "As at" : "To"}
        <input type="date" name="to" defaultValue={to} className={field} />
      </label>
      <button className="min-h-10 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white">Show</button>
    </form>
  );
}

/** An English date with its Nepali date beside it. */
export function Dates({ date }: { date: string }) {
  return (
    <span className="whitespace-nowrap">
      {date} <span className="text-xs text-stone-500">({bsText(date)} BS)</span>
    </span>
  );
}

export function Money({ paisa, className = "" }: { paisa: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatNpr(paisa)}</span>;
}

export function ErrorNote({ error }: { error?: string | string[] }) {
  if (typeof error !== "string" || !error) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {error}
    </p>
  );
}

export const TYPE_LABEL = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expenses" } as const;
