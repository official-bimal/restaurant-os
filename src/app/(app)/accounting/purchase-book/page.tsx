import { requireTenant } from "@/server/auth";
import { currentPeriod } from "@/features/accounting/server/service";
import { getPurchaseBook } from "@/features/accounting/server/registers";
import { AccountingTabs, pickRange, RangeForm } from "../ui";
import { BookTable } from "../book-table";

export const dynamic = "force-dynamic";

export default async function PurchaseBookPage({ searchParams }: PageProps<"/accounting/purchase-book">) {
  const ctx = await requireTenant("books.view");
  const sp = await searchParams;
  const p = await currentPeriod(ctx);
  const { from, to } = pickRange(sp, { from: p.from, to: p.today });
  const { rows, totals } = await getPurchaseBook(ctx, from, to);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Purchase book</h1>
      <AccountingTabs current="/accounting/purchase-book" />
      <RangeForm from={from} to={to} />
      <p className="text-sm text-stone-600">
        Supplier bills entered under Stock, bills. Enter the VAT inside each bill and the supplier&apos;s PAN so this book and the VAT summary are complete.{" "}
        <a className="text-teal-700 underline" href={`/accounting/export/purchase?from=${from}&to=${to}`}>
          Download CSV
        </a>
      </p>
      <BookTable rows={rows} totals={totals} party="Supplier" />
    </div>
  );
}
