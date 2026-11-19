import { requireTenant } from "@/server/auth";
import { currentPeriod } from "@/features/accounting/server/service";
import { getSalesBook } from "@/features/accounting/server/registers";
import { AccountingTabs, pickRange, RangeForm } from "../ui";
import { BookTable } from "../book-table";

export const dynamic = "force-dynamic";

export default async function SalesBookPage({ searchParams }: PageProps<"/accounting/sales-book">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const { from, to } = pickRange(sp, { from: p.from, to: p.today });
  const { rows, totals } = await getSalesBook(ctx, from, to);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Sales book</h1>
      <AccountingTabs current="/accounting/sales-book" />
      <RangeForm from={from} to={to} />
      <p className="text-sm text-stone-600">
        Every bill and credit note, in order, with the VAT on each. Refunds show as negative rows.{" "}
        <a className="text-brand-700 underline" href={`/accounting/export/sales?from=${from}&to=${to}`}>
          Download CSV
        </a>
      </p>
      <BookTable rows={rows} totals={totals} party="Buyer" />
    </div>
  );
}
