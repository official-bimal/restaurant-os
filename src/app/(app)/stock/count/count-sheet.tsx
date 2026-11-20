"use client";

import { useMemo, useState } from "react";
import { countSheetAction } from "../actions";
import { countTone, parseCounted } from "@/features/stock/count";

interface Row {
  id: string;
  name: string;
  unit: string;
  book: number;
  costMilli: number;
}

const rs = (paisa: number) => `Rs ${(Math.abs(paisa) / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * The shelf-by-shelf count sheet. Type what is really there for each item; an item left blank is not counted and is not touched. The
 * difference from the book shows as you type, and nothing changes until you save the sheet.
 */
export function CountSheet({ rows }: { rows: Row[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");

  const summary = useMemo(() => {
    let counted = 0;
    let changed = 0;
    let value = 0;
    let bad = 0;
    for (const r of rows) {
      const c = parseCounted(values[r.id]);
      if (c === null) continue;
      if (c === "bad") {
        bad += 1;
        continue;
      }
      counted += 1;
      const diff = c - r.book;
      if (diff !== 0) {
        changed += 1;
        value += Math.round((diff * r.costMilli) / 1000);
      }
    }
    return { counted, changed, value, bad };
  }, [rows, values]);

  const shown = rows.filter((r) => r.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <form action={countSheetAction} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="sr-only">Find an item</span>
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an item" className="min-h-10 w-56 rounded-lg border border-stone-300 px-3 text-sm" />
        </label>
        <p className="text-sm text-stone-600" role="status">
          {summary.counted === 0 ? "Nothing counted yet." : `${summary.counted} counted, ${summary.changed} different from the book${summary.changed > 0 ? ` (${summary.value < 0 ? "missing" : "extra"} ${rs(summary.value)})` : ""}.`}
          {summary.bad > 0 && <span className="text-red-700"> {summary.bad} amount{summary.bad === 1 ? " is" : "s are"} not a whole number.</span>}
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="text-stone-500">
            <tr>
              <th className="py-2 pr-3 font-medium">Item</th>
              <th className="py-2 pr-3 text-right font-medium">Book says</th>
              <th className="py-2 pr-3 font-medium">You counted</th>
              <th className="py-2 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => {
              const c = parseCounted(values[r.id]);
              const diff = typeof c === "number" ? c - r.book : null;
              const tone = diff === null ? null : countTone(diff);
              const hidden = !shown.includes(r);
              return (
                <tr key={r.id} className={hidden ? "hidden" : ""}>
                  <td className="py-2 pr-3 font-medium">{r.name}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.book.toLocaleString("en-GB")} {r.unit}
                  </td>
                  <td className="py-2 pr-3">
                    <label className="flex items-center gap-2">
                      <span className="sr-only">Counted {r.name}</span>
                      <input
                        name={`count_${r.id}`}
                        inputMode="numeric"
                        autoComplete="off"
                        value={values[r.id] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value }))}
                        className={`min-h-10 w-28 rounded-lg border px-2 py-1.5 tabular-nums ${c === "bad" ? "border-red-500" : "border-stone-300"}`}
                      />
                      <span className="text-xs text-stone-500">{r.unit}</span>
                    </label>
                  </td>
                  <td className={`py-2 text-right tabular-nums ${tone === "short" ? "font-medium text-red-700" : tone === "over" ? "font-medium text-green-800" : "text-stone-400"}`}>
                    {diff === null ? "" : diff === 0 ? "same" : `${diff > 0 ? "+" : ""}${diff.toLocaleString("en-GB")} ${r.unit}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium">
          Note (optional)
          <input name="note" maxLength={200} placeholder="e.g. Sunday close" className="mt-1 block min-h-10 w-72 rounded-lg border border-stone-300 px-3 text-sm font-normal" />
        </label>
        <button disabled={summary.counted === 0 || summary.bad > 0} className="min-h-11 rounded-lg bg-brand-600 px-5 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          Save the count
        </button>
      </div>
      <p className="text-xs text-stone-500">Saving makes the book match what you counted for the items you filled in. The differences are kept in the stock history as one count.</p>
    </form>
  );
}
