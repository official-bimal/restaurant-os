import { isValidDate } from "@/lib/business-day";
import { bsText } from "@/features/accounting/fiscal";
import { formatNpr } from "@/features/billing/calc";

export const field = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

/** The Accounts menu now lives in the layout beside every page, so the old tab row draws nothing. */
export function AccountingTabs({ current }: { current: string }) {
  void current;
  return null;
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
      <button className="min-h-10 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">Show</button>
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
