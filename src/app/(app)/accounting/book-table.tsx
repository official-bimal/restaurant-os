import type { BookRow, Totals } from "@/features/accounting/server/registers";
import { Money } from "./ui";

/** A sales or purchase book as a table, with its totals. */
export function BookTable({ rows, totals, party }: { rows: BookRow[]; totals: Totals; party: string }) {
  return (
    <section className="card overflow-x-auto p-4">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="text-left text-stone-600">
            <th className="py-1">Miti (BS)</th>
            <th className="py-1">Date</th>
            <th className="py-1">Bill no.</th>
            <th className="py-1">{party}</th>
            <th className="py-1">PAN</th>
            <th className="py-1 text-right">Total</th>
            <th className="py-1 text-right">Non-taxable</th>
            <th className="py-1 text-right">Taxable</th>
            <th className="py-1 text-right">VAT</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="py-2 text-stone-600">
                Nothing in this period.
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={`${r.number}-${i}`} className="border-t border-stone-100">
              <td className="py-1 whitespace-nowrap">{r.bs}</td>
              <td className="py-1 whitespace-nowrap">{r.date}</td>
              <td className="py-1 whitespace-nowrap">
                {r.number}
                {r.note && <div className="text-xs text-stone-500">{r.note}</div>}
              </td>
              <td className="py-1">{r.name ?? ""}</td>
              <td className="py-1">{r.pan ?? ""}</td>
              <td className="py-1 text-right"><Money paisa={r.total} /></td>
              <td className="py-1 text-right"><Money paisa={r.nonTaxable} /></td>
              <td className="py-1 text-right"><Money paisa={r.taxable} /></td>
              <td className="py-1 text-right"><Money paisa={r.vat} /></td>
            </tr>
          ))}
          <tr className="border-t-2 border-stone-300 font-semibold">
            <td className="py-1" colSpan={5}>Total</td>
            <td className="py-1 text-right"><Money paisa={totals.total} /></td>
            <td className="py-1 text-right"><Money paisa={totals.nonTaxable} /></td>
            <td className="py-1 text-right"><Money paisa={totals.taxable} /></td>
            <td className="py-1 text-right"><Money paisa={totals.vat} /></td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
