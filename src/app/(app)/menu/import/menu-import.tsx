"use client";

import { useState, useTransition } from "react";
import { applyImportAction, previewImportAction, type ApplyResult, type PreviewResult } from "./actions";

const TONE = { ADD: "bg-emerald-50 text-emerald-800", UPDATE: "bg-amber-50 text-amber-900", SAME: "bg-stone-100 text-stone-600" } as const;
const LABEL = { ADD: "New", UPDATE: "Changes", SAME: "No change" } as const;

/** Choose a CSV, see what it would do, then apply it. The file is read on this device; nothing is saved until Apply. */
export function MenuImport() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [done, setDone] = useState<ApplyResult | null>(null);
  const [pending, start] = useTransition();

  const choose = async (file: File | undefined) => {
    setPreview(null);
    setDone(null);
    if (!file) return;
    const t = await file.text();
    setText(t);
    setFileName(file.name);
    start(async () => setPreview(await previewImportAction(t)));
  };

  const apply = () =>
    start(async () => {
      const r = await applyImportAction(text);
      setDone(r);
      if (r.ok) setPreview(null);
    });

  const p = preview?.ok ? preview.preview : null;
  return (
    <div className="space-y-4">
      <label className="flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-stone-300 bg-white p-4 text-sm text-stone-700">
        {fileName ? `Chosen: ${fileName} (choose another)` : "Choose a menu file (.csv)"}
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
      </label>
      {pending && <p className="text-sm text-stone-500">Working…</p>}
      {preview && !preview.ok && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {preview.error}
        </p>
      )}
      {done && !done.ok && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {done.error}
        </p>
      )}
      {done?.ok && (
        <div role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Done: {done.added} added, {done.updated} changed, {done.unchanged} already the same{done.skipped.length ? `, ${done.skipped.length} skipped with a problem` : ""}.
        </div>
      )}
      {p && (
        <>
          <p className="text-sm text-stone-700">
            <strong>{p.counts.add}</strong> new, <strong>{p.counts.update}</strong> changed, <strong>{p.counts.same}</strong> the same
            {p.counts.errors ? (
              <>
                , <strong className="text-red-700">{p.counts.errors}</strong> with a problem (skipped)
              </>
            ) : null}
            .
          </p>
          {p.parsed.errors.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {p.parsed.errors.slice(0, 30).map((e) => (
                <li key={`${e.line}-${e.message}`}>
                  Line {e.line}: {e.message}
                </li>
              ))}
              {p.parsed.errors.length > 30 && <li>and {p.parsed.errors.length - 30} more.</li>}
            </ul>
          )}
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
                  <th className="px-4 py-2 font-semibold">Dish</th>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 text-right font-semibold">Price</th>
                  <th className="px-4 py-2 font-semibold">What happens</th>
                </tr>
              </thead>
              <tbody>
                {p.plan.slice(0, 300).map((x) => (
                  <tr key={x.row.line} className="border-b border-stone-100">
                    <td className="px-4 py-2">{x.row.name}</td>
                    <td className="px-3 py-2">{x.row.category}</td>
                    <td className="px-3 py-2 text-right tabular-nums">Rs {x.row.price / 100}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[x.action]}`}>{LABEL[x.action]}</span>
                      {x.action === "UPDATE" && <span className="ml-2 text-xs text-stone-600">{x.changes.join(", ")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.plan.length > 300 && <p className="text-xs text-stone-500">Showing the first 300 of {p.plan.length}.</p>}
          <button type="button" onClick={apply} disabled={pending || p.counts.add + p.counts.update === 0} className="min-h-11 rounded-lg bg-brand-600 px-6 font-medium text-white disabled:opacity-50">
            {p.counts.add + p.counts.update === 0 ? "Nothing to change" : `Apply ${p.counts.add + p.counts.update} change${p.counts.add + p.counts.update === 1 ? "" : "s"}`}
          </button>
        </>
      )}
    </div>
  );
}
