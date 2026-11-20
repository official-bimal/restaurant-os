"use client";

import { useMemo, useState } from "react";
import { BILL_FIELDS, KOT_FIELDS, type SlipFields } from "@/features/printing/slip-fields";
import { layoutKitchen, layoutReceipt, type LayoutSettings } from "@/features/printing/layout";
import { SAMPLE_KITCHEN, SAMPLE_RECEIPT } from "@/features/printing/samples";

type Line = { text: string; bold?: boolean; size?: number };

function Paper({ lines, cols, label }: { lines: Line[]; cols: number; label: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <pre
        aria-label={`${label} preview`}
        className="overflow-x-auto rounded-md border border-stone-300 bg-white p-4 font-mono leading-tight text-stone-900 shadow-inner"
        style={{ width: `calc(${cols}ch + 2rem)`, fontSize: "12px", maxWidth: "100%" }}
      >
        {lines.map((l, i) => (
          <span key={i} className="block whitespace-pre" style={{ fontWeight: l.bold ? 700 : 400, fontSize: l.size && l.size > 1 ? `${l.size}em` : undefined, lineHeight: 1.3 }}>
            {l.text || " "}
          </span>
        ))}
      </pre>
    </div>
  );
}

/** Tick what should print on a kitchen slip and a bill; the two slips beside it change as you tick. Saved only with the Save button. */
export function FieldsForm({ initial, layout, cols, save }: { initial: SlipFields; layout: LayoutSettings; cols: number; save: (fd: FormData) => void | Promise<void> }) {
  const [f, setF] = useState<SlipFields>(initial);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const settings = useMemo(() => ({ ...layout, fields: f }), [layout, f]);
  const kitchen = useMemo(() => layoutKitchen(SAMPLE_KITCHEN, settings, cols), [settings, cols]);
  const bill = useMemo(() => layoutReceipt(SAMPLE_RECEIPT, settings, cols), [settings, cols]);
  const toggle = (group: "kot" | "bill", key: string) => setF((s) => ({ ...s, [group]: { ...s[group], [key]: !(s[group] as Record<string, boolean>)[key] } }) as SlipFields);

  const list = (group: "kot" | "bill", defs: readonly { key: string; label: string; hint: string }[]) => (
    <div className="space-y-1">
      {defs.map((d) => (
        <label key={d.key} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-stone-50">
          <input type="checkbox" name={`${group}.${d.key}`} checked={(f[group] as Record<string, boolean>)[d.key]} onChange={() => toggle(group, d.key)} className="mt-1 size-4" />
          <span>
            <span className="block text-sm font-medium">{d.label}</span>
            <span className="block text-xs text-stone-500">{d.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );

  return (
    <form action={save} className="space-y-5">
      <div className="grid gap-6 xl:grid-cols-[1fr_auto]">
        <div className="grid gap-5 md:grid-cols-2">
          <section className="card p-4" aria-labelledby="kot">
            <h2 id="kot" className="mb-1 font-semibold">
              Kitchen slip
            </h2>
            <p className="mb-2 text-xs text-stone-500">What the cook sees. Dish names and quantities always print.</p>
            {list("kot", KOT_FIELDS)}
          </section>
          <section className="card p-4" aria-labelledby="bill">
            <h2 id="bill" className="mb-1 font-semibold">
              Bill
            </h2>
            <p className="mb-2 text-xs text-stone-500">The invoice number, date, items, VAT and totals always print: a tax invoice needs them.</p>
            {list("bill", BILL_FIELDS)}
            <p className="mt-2 text-xs text-stone-500">PAN, address and the customer&apos;s name are chosen on the Paper and queue tab.</p>
          </section>
        </div>
        <div className="space-y-4" aria-live="polite">
          <Paper lines={kitchen} cols={cols} label="Kitchen slip" />
          <Paper lines={bill} cols={cols} label="Bill" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={!dirty}>
          Save
        </button>
        <button type="button" className="btn-secondary" disabled={!dirty} onClick={() => setF(initial)}>
          Cancel changes
        </button>
        {dirty && <span className="text-sm text-amber-800">Previewing. Not saved yet.</span>}
      </div>
    </form>
  );
}
