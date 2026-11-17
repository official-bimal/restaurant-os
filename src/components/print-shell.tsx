"use client";

import { useEffect } from "react";

/**
 * Wraps a printed page: sets the paper size, shows a Print button (not printed), and, when asked, opens the browser's
 * print dialog by itself. This is the browser's normal print: it uses whatever printer the device has chosen. Nothing is
 * sent to a printer without that dialog unless the browser itself is set up to skip it.
 */
export function PrintShell({ width, auto, children }: { width: 58 | 80; auto: boolean; children: React.ReactNode }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <div className="print-root mx-auto bg-white p-3 font-mono text-[12px] leading-snug text-black" style={{ width: `${width}mm`, maxWidth: "100%" }}>
      <style>{`
        @page { size: ${width}mm auto; margin: 3mm; }
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-root { width: 100% !important; padding: 0 !important; }
        }
      `}</style>
      <div className="no-print mb-3 flex gap-2 font-sans">
        <button type="button" onClick={() => window.print()} className="min-h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white">
          Print
        </button>
        <button type="button" onClick={() => window.close()} className="min-h-10 rounded-lg border border-stone-300 px-4 text-sm">
          Close
        </button>
      </div>
      {children}
    </div>
  );
}

export function Rule() {
  return <hr className="my-1.5 border-0 border-t border-dashed border-black" />;
}

export function Row({ left, right, bold }: { left: React.ReactNode; right?: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? "font-bold" : ""}`}>
      <span className="min-w-0 break-words">{left}</span>
      {right !== undefined && <span className="shrink-0">{right}</span>}
    </div>
  );
}
