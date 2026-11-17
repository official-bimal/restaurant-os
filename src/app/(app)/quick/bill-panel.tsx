"use client";

import { useMemo, useState } from "react";
import type { DiscountInput } from "@/features/billing/calc";
import { formatNpr } from "@/features/billing/calc";
import { OfflineBillError, PAY_METHODS, type PayMethod } from "@/features/offline/billing";
import { makeBill, parseSnapshot, previewTotals, receiptPdf, type SavedBill, type StoredSnapshot } from "@/features/offline/client";

const METHOD_LABEL: Record<PayMethod, string> = { CASH: "Cash", QR: "QR", CARD: "Card" };

/** Open a receipt PDF built on this phone (works with no connection). */
export function openReceipt(saved: SavedBill, print: StoredSnapshot["print"] | undefined, paper?: { widthMm?: number; heightMm?: number | null }) {
  const bytes = receiptPdf(saved, print, paper);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Take payment for the cart and make the bill, with or without a connection. The total shown here is worked out by exactly
 * the same code the server uses when the bill arrives, from the prices the server signed for this phone.
 */
export function BillPanel({
  stored,
  cart,
  type,
  tableId,
  onBilled,
  onClose,
}: {
  stored: StoredSnapshot;
  cart: { menuItemId: string; quantity: number; note?: string }[];
  type: "DINE_IN" | "TAKEAWAY";
  tableId: string | null;
  /** Called once the bill is saved, so the page can clear the cart and start sending. */
  onBilled: (saved: SavedBill) => void;
  onClose: () => void;
}) {
  const snap = useMemo(() => parseSnapshot(stored), [stored]);
  const [discountPct, setDiscountPct] = useState("");
  const [method, setMethod] = useState<PayMethod>("CASH");
  const [split, setSplit] = useState(false);
  const [amounts, setAmounts] = useState<Record<PayMethod, string>>({ CASH: "", QR: "", CARD: "" });
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SavedBill | null>(null);

  const discount: DiscountInput = useMemo(() => {
    const pct = Number(discountPct);
    return Number.isFinite(pct) && pct > 0 ? { kind: "percent", bps: Math.round(pct * 100) } : { kind: "none" };
  }, [discountPct]);

  const priced = useMemo(() => {
    try {
      return { ok: true as const, ...previewTotals(snap, cart, discount) };
    } catch (e) {
      return { ok: false as const, error: e instanceof OfflineBillError ? e.message : "Could not work out the bill." };
    }
  }, [snap, cart, discount]);

  const total = priced.ok ? priced.totals.grandTotal : 0;
  const paisa = (v: string) => Math.round(Number(v || 0) * 100);
  const entered = split ? PAY_METHODS.reduce((n, m) => n + paisa(amounts[m]), 0) : total;
  const short = total - entered;

  const confirm = () => {
    setError(null);
    try {
      const payments = split ? PAY_METHODS.map((m) => ({ method: m, amount: paisa(amounts[m]) })).filter((p) => p.amount > 0) : [{ method, amount: total }];
      const saved = makeBill(stored, { type, tableId, items: cart, discount, payments, customerPhone: phone }, new Date());
      setDone(saved);
      onBilled(saved);
    } catch (e) {
      setError(e instanceof OfflineBillError ? e.message : "Could not make the bill.");
    }
  };

  if (done) {
    return (
      <section className="card space-y-3 p-4" aria-live="polite">
        <h2 className="text-lg font-semibold text-emerald-800">Paid · Invoice #{done.invoiceNumber}</h2>
        <p className="text-sm text-stone-600">
          {formatNpr(done.receipt.grandTotal)} · {done.receipt.payments.map((p) => `${METHOD_LABEL[p.method as PayMethod] ?? p.method} ${formatNpr(p.amount)}`).join(", ")}. Saved on this phone and sent to the server when there is a connection.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openReceipt(done, stored.print)} className="min-h-11 rounded-lg bg-brand-600 px-4 font-medium text-white hover:bg-brand-700">
            Print receipt (PDF)
          </button>
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-stone-300 px-4 font-medium">
            New order
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Bill and pay</h2>
        <button type="button" onClick={onClose} className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm">
          Back to the order
        </button>
      </div>

      {!priced.ok ? (
        <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800">
          {priced.error}
        </p>
      ) : (
        <dl className="space-y-1 text-sm">
          {[
            ["Subtotal", priced.totals.subtotal],
            ...(priced.totals.discount ? ([["Discount", -priced.totals.discount]] as [string, number][]) : []),
            ["Service charge", priced.totals.serviceCharge],
            ["VAT", priced.totals.vat],
            ...(priced.totals.roundOff ? ([["Round off", priced.totals.roundOff]] as [string, number][]) : []),
          ].map(([k, v]) => (
            <div key={String(k)} className="flex justify-between">
              <dt className="text-stone-600">{k}</dt>
              <dd>{formatNpr(Number(v))}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-stone-200 pt-1 text-lg font-semibold">
            <dt>Total</dt>
            <dd>{formatNpr(total)}</dd>
          </div>
        </dl>
      )}

      <label className="block text-sm font-medium">
        Discount (%)
        <input value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} inputMode="decimal" placeholder="0" className="mt-1 block w-28 px-3 py-2" />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Paid by</legend>
        {!split ? (
          <div role="radiogroup" className="flex gap-2">
            {PAY_METHODS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={`min-h-11 flex-1 rounded-xl border px-3 text-sm font-medium ${method === m ? "border-brand-600 bg-brand-50 text-brand-700" : "border-stone-300"}`}>
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {PAY_METHODS.map((m) => (
              <label key={m} className="text-xs font-medium">
                {METHOD_LABEL[m]} (Rs)
                <input value={amounts[m]} onChange={(e) => setAmounts((a) => ({ ...a, [m]: e.target.value }))} inputMode="decimal" className="mt-1 block w-full px-2 py-2 text-sm" />
              </label>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} className="h-4 w-4" /> Split between methods
        </label>
        {split && (
          <p className={`text-sm ${short === 0 ? "text-emerald-700" : "text-amber-800"}`}>{short === 0 ? "Adds up exactly." : short > 0 ? `${formatNpr(short)} still to enter.` : `${formatNpr(-short)} too much.`}</p>
        )}
        <p className="text-xs text-stone-500">QR and card payments are recorded as you enter them; with no connection they cannot be checked until later.</p>
      </fieldset>

      <label className="block text-sm font-medium">
        Customer phone (optional, for loyalty points)
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="98XXXXXXXX" className="mt-1 block w-full max-w-xs px-3 py-2" />
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <button type="button" onClick={confirm} disabled={!priced.ok || (split && short !== 0)} className="min-h-12 w-full rounded-lg bg-emerald-600 px-4 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
        Confirm payment · {formatNpr(total)}
      </button>
    </section>
  );
}
