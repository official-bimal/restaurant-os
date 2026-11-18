"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { randomKey } from "@/lib/random-key";
import { formatNpr } from "@/features/billing/calc";
import type { CheckoutApi } from "@/app/t/[token]/guest-menu";
import { placeOrderAction, quoteAction } from "./actions";

export interface CheckoutBranch {
  pickup: boolean;
  delivery: boolean;
  minOrder: number;
  prepMinutes: number;
  zones: { id: string; name: string; fee: number }[];
  byDistance: boolean;
}

const field = "mt-1 block w-full min-h-11 rounded-xl px-3 py-2 text-base";

/** The details the customer fills in before sending the order: pickup or delivery, who they are, where to bring it. */
export function OnlineCheckout({ token, branch, api }: { token: string; branch: CheckoutBranch; api: CheckoutApi }) {
  const router = useRouter();
  const [type, setType] = useState<"TAKEAWAY" | "DELIVERY">(branch.pickup ? "TAKEAWAY" : "DELIVERY");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [note, setNote] = useState("");
  const [quote, setQuote] = useState<{ fee: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // One key per order: a second tap, or a retry after a bad connection, cannot make a duplicate.
  const key = useRef(randomKey());

  const delivery = type === "DELIVERY";
  const zone = branch.zones.find((z) => z.id === zoneId);
  // The fee shown: from the chosen area, from the distance quote, or nothing yet.
  const fee = !delivery ? 0 : branch.byDistance ? (quote?.fee ?? null) : branch.zones.length > 0 ? (zone?.fee ?? null) : 0;
  const short = branch.minOrder > 0 && api.total < branch.minOrder;

  const getFee = () => {
    setError(null);
    start(async () => {
      const r = await quoteAction(token, { address, phone, location: location || undefined, zoneId: zoneId || undefined });
      if (r.ok) setQuote({ fee: r.fee, label: r.label });
      else {
        setQuote(null);
        setError(r.error);
      }
    });
  };

  const useMyLocation = () => {
    setError(null);
    if (!navigator.geolocation) return setError("Your browser cannot share a location. Type your address instead.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocation(`${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`);
        setQuote(null);
      },
      () => setError("Could not get your location. Type your address instead."),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  };

  const send = () => {
    if (pending) return;
    setError(null);
    start(async () => {
      const r = await placeOrderAction(token, {
        idempotencyKey: key.current,
        type,
        name,
        phone,
        note: note.trim() || undefined,
        ...(delivery ? { address, location: location || undefined, zoneId: zoneId || undefined } : {}),
        items: api.lines,
      });
      if (r.ok) {
        key.current = randomKey();
        api.reset();
        router.push(r.url);
      } else setError(r.error);
    });
  };

  const choice = (value: "TAKEAWAY" | "DELIVERY", label: string, enabled: boolean) =>
    enabled && (
      <button
        type="button"
        role="radio"
        aria-checked={type === value}
        onClick={() => {
          setType(value);
          setError(null);
        }}
        className={`min-h-11 flex-1 rounded-xl border px-3 font-medium ${type === value ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300"}`}
      >
        {label}
      </button>
    );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {branch.pickup && branch.delivery && (
        <div role="radiogroup" aria-label="How do you want it?" className="flex gap-2">
          {choice("TAKEAWAY", "Pickup", branch.pickup)}
          {choice("DELIVERY", "Delivery", branch.delivery)}
        </div>
      )}

      <label className="block text-sm font-medium">
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="name" className={field} />
      </label>
      <label className="block text-sm font-medium">
        Phone number
        <input value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" autoComplete="tel" placeholder="98XXXXXXXX" className={field} />
      </label>

      {delivery && (
        <>
          <label className="block text-sm font-medium">
            Delivery address
            <textarea
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setQuote(null);
              }}
              required
              maxLength={200}
              rows={2}
              autoComplete="street-address"
              placeholder="House, street, landmark, area"
              className={field}
            />
          </label>
          {branch.zones.length > 0 && (
            <label className="block text-sm font-medium">
              Delivery area
              <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} required className={field}>
                <option value="">Choose your area</option>
                {branch.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} (+{formatNpr(z.fee)})
                  </option>
                ))}
              </select>
            </label>
          )}
          {branch.byDistance && (
            <div className="space-y-2 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
              <p className="text-sm text-stone-600">The delivery fee depends on how far you are. Share your location or paste a map link or coordinates.</p>
              <div className="flex gap-2">
                <input value={location} onChange={(e) => { setLocation(e.target.value); setQuote(null); }} placeholder="27.7172, 85.3240 or a map link" aria-label="Your location" className="block min-h-11 w-full rounded-xl px-3 py-2 text-base" />
                <button type="button" onClick={useMyLocation} className="min-h-11 shrink-0 rounded-xl border border-stone-300 px-3 text-sm font-medium">
                  Use mine
                </button>
              </div>
              <button type="button" onClick={getFee} disabled={pending} className="min-h-11 w-full rounded-xl border border-brand-600 px-3 font-medium text-brand-600 disabled:opacity-60">
                {quote ? `Delivery fee ${formatNpr(quote.fee)} (${quote.label})` : "Work out the delivery fee"}
              </button>
            </div>
          )}
        </>
      )}

      <label className="block text-sm font-medium">
        Note for the restaurant (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="No onion, ring the bell, ..." className={field} />
      </label>

      <dl className="space-y-1 rounded-xl bg-white/5 p-3 text-sm ring-1 ring-white/10">
        <div className="flex justify-between">
          <dt>Food</dt>
          <dd>{formatNpr(api.total)}</dd>
        </div>
        {delivery && (
          <div className="flex justify-between">
            <dt>Delivery</dt>
            <dd>{fee === null ? "choose above" : fee === 0 ? "free" : formatNpr(fee)}</dd>
          </div>
        )}
        <p className="pt-1 text-xs text-stone-500">Service charge and VAT are added to the final bill. You pay {delivery ? "when it arrives" : "when you pick it up"}, in cash or by QR or card if the restaurant takes it.</p>
      </dl>

      {short && (
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          The minimum order is {formatNpr(branch.minOrder)}. Add {formatNpr(branch.minOrder - api.total)} more.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <button disabled={pending || short} className="min-h-12 w-full rounded-full bg-brand-600 px-4 text-lg font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {pending ? "Sending…" : `Send order · ${formatNpr(api.total + (fee ?? 0))}`}
      </button>
      <p className="text-center text-xs text-stone-500">The restaurant will accept your order. You can follow it on the next page.</p>
    </form>
  );
}
