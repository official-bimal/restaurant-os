"use client";

import { useState } from "react";

/**
 * A "Print" button with a choice of how and on what paper: a PDF at any size (open it, save it, print it from anywhere), the
 * browser's own print page, or a file a thermal printer reads directly. The size defaults to the business's saved paper and can
 * be changed for just this print.
 */
export function PrintMenu({
  kind,
  id,
  label = "Print",
  defaultWidthMm,
  defaultHeightMm,
  className = "",
  queue,
}: {
  kind: "invoice" | "credit-note" | "kitchen";
  id: string;
  label?: string;
  defaultWidthMm: number;
  defaultHeightMm: number | null;
  className?: string;
  /** Adds a "Send to printer queue" button when given (a server action prepared by the page). */
  queue?: React.ReactNode;
}) {
  const [w, setW] = useState(String(defaultWidthMm));
  const [h, setH] = useState(defaultHeightMm ? String(defaultHeightMm) : "");
  const sizeQuery = `w=${encodeURIComponent(w || defaultWidthMm)}&h=${encodeURIComponent(h || "0")}`;
  const file = (format: string) => `/api/print/file?kind=${kind}&id=${encodeURIComponent(id)}&format=${format}&${sizeQuery}`;
  const btn = "inline-flex min-h-9 items-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium hover:bg-stone-50";

  return (
    <details className={`relative ${className}`}>
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium hover:bg-stone-50">{label} ▾</summary>
      <div className="absolute right-0 z-20 mt-1 w-72 space-y-3 rounded-xl border border-stone-200 bg-white p-3 shadow-lg">
        <div className="flex items-end gap-2 text-xs font-medium text-stone-600">
          <label className="flex-1">
            Paper width (mm)
            <input value={w} onChange={(e) => setW(e.target.value)} inputMode="numeric" className="mt-1 block w-full px-2 py-1.5 text-sm" />
          </label>
          <label className="flex-1">
            Height (mm)
            <input value={h} onChange={(e) => setH(e.target.value)} inputMode="numeric" placeholder="auto" className="mt-1 block w-full px-2 py-1.5 text-sm" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={file("pdf")} target="_blank" rel="noreferrer" className={`${btn} bg-brand-600 text-white hover:bg-brand-700`} style={{ background: "var(--color-brand-600)", color: "#fff" }}>
            PDF
          </a>
          <a href={`/print/${kind === "invoice" ? "invoice" : kind === "credit-note" ? "credit-note" : "kitchen"}/${encodeURIComponent(id)}?auto=1&w=${encodeURIComponent(w || defaultWidthMm)}`} target="_blank" rel="noreferrer" className={btn}>
            Browser print
          </a>
          <a href={file("escpos")} className={btn}>
            Printer file
          </a>
          <a href={file("text")} target="_blank" rel="noreferrer" className={btn}>
            Text
          </a>
        </div>
        {queue}
        <p className="text-xs text-stone-500">Leave height empty for paper exactly as long as the slip. The size here applies to this print only; change the default under Printing settings.</p>
      </div>
    </details>
  );
}
