"use client";

import { useState } from "react";
import { DENOMINATIONS } from "@/features/drawer/drawer";

/** Count the drawer by notes and coins (the total fills in by itself), or type the total. Posts to the close action. */
export function CountForm({ action, expectedRupees }: { action: (fd: FormData) => void | Promise<void>; expectedRupees: number }) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [typed, setTyped] = useState("");
  const byNotes = DENOMINATIONS.reduce((n, d) => n + d * (Number(counts[d]) || 0), 0);
  const usingNotes = Object.values(counts).some((v) => v !== "" && Number(v) > 0);
  const total = usingNotes ? byNotes : Number(typed.replace(/,/g, "")) || 0;
  const diff = total - expectedRupees;

  return (
    <form action={action} className="card space-y-4 p-5">
      <h2 className="font-semibold">Count and close the drawer</h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {DENOMINATIONS.map((d) => (
          <label key={d} className="text-xs font-medium text-stone-600">
            Rs {d}
            <input
              inputMode="numeric"
              value={counts[d] ?? ""}
              onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, "").slice(0, 5) }))}
              aria-label={`How many Rs ${d}`}
              className="mt-1 block w-full rounded-lg border border-stone-300 px-2 py-2 text-base"
            />
          </label>
        ))}
      </div>
      <label className="block text-sm">
        Or type the total counted (Rs)
        <input name={usingNotes ? undefined : "counted"} value={usingNotes ? String(byNotes) : typed} onChange={(e) => setTyped(e.target.value)} disabled={usingNotes} inputMode="decimal" className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base" />
      </label>
      {usingNotes && <input type="hidden" name="counted" value={byNotes} />}
      <p className={`rounded-lg px-3 py-2 text-sm ${total === 0 ? "bg-stone-50 text-stone-600" : diff === 0 ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
        Counted: <strong>Rs {total.toLocaleString("en-US")}</strong>. {total === 0 ? "Enter what is in the drawer." : diff === 0 ? "That matches what the drawer should hold." : `That is ${diff < 0 ? "short" : "over"} by Rs ${Math.abs(diff).toLocaleString("en-US")}. Say why below.`}
      </p>
      <label className="block text-sm">
        Note {diff !== 0 && total > 0 ? <span className="text-red-700">(required: why is it {diff < 0 ? "short" : "over"}?)</span> : "(optional)"}
        <input name="note" maxLength={200} className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base" />
      </label>
      <button className="min-h-11 rounded-lg bg-brand-600 px-6 font-medium text-white">Close the drawer</button>
    </form>
  );
}
