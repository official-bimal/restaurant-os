"use client";

import { useMemo, useState } from "react";
import { calculateBill, formatNpr, type VatMode } from "@/features/billing/calc";
import { cutPrice, dropGuests, everythingOnFirst, guestSubtotal, MAX_GUESTS, planSplit, shareName, type Assignment, type PlannedLine, type SplitItem } from "@/features/billing/split-items";

interface Item extends SplitItem {
  status: string;
  complimentary: boolean;
  note: string | null;
  extras: string[];
}
interface Config {
  serviceChargeBps: number;
  vatMode: VatMode;
  vatBps: number;
  vatAppliesToServiceCharge: boolean;
  roundToRupee: boolean;
}

const CHIP = ["bg-indigo-600", "bg-emerald-600", "bg-amber-600", "bg-rose-600", "bg-sky-600", "bg-violet-600", "bg-teal-600", "bg-orange-600"];

/**
 * Give each dish to a guest, or share it. Every unit of a dish has a row of guest buttons: tap one guest and it is theirs; tap several and
 * they share it equally. Each guest's bill (with service charge and VAT, before any discount) updates as you go.
 */
export function SplitEditor({ action, idempotencyKey, items, config, firstLabel }: { action: (fd: FormData) => void | Promise<void>; idempotencyKey: string; items: Item[]; config: Config; firstLabel: string }) {
  const [labels, setLabels] = useState<string[]>([firstLabel || "Guest 1", "Guest 2"]);
  const [assign, setAssign] = useState<Assignment[]>(() => everythingOnFirst(items));
  const guestCount = labels.length;
  const name = (g: number) => labels[g]?.trim() || `Guest ${g + 1}`;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const plan = useMemo<{ lines: PlannedLine[] | null; error: string | null }>(() => {
    try {
      return { lines: planSplit(items, assign, guestCount), error: null };
    } catch (e) {
      return { lines: null, error: e instanceof RangeError ? e.message : "That split does not work." };
    }
  }, [items, assign, guestCount]);

  const rows = useMemo(() => {
    // Re-plan every item on its own without the "everyone needs something" rule, to price each guest live.
    const out: PlannedLine[] = [];
    for (const it of items) {
      const a = assign.find((x) => x.itemId === it.id);
      if (!a) continue;
      const groups = new Map<string, { guests: number[]; units: number }>();
      for (const u of a.units) {
        const guests = [...new Set(u)].sort((x, y) => x - y);
        const key = guests.join(",");
        const g = groups.get(key);
        if (g) g.units++;
        else groups.set(key, { guests, units: 1 });
      }
      for (const { guests, units } of groups.values()) {
        if (guests.length === 1) out.push({ itemId: it.id, guest: guests[0]!, quantity: units, unitPrice: it.unitPrice, shareDen: 1 });
        else {
          const parts = cutPrice(it.unitPrice, guests.length);
          guests.forEach((guest, i) => out.push({ itemId: it.id, guest, quantity: units, unitPrice: parts[i]!, shareDen: guests.length }));
        }
      }
    }
    return out;
  }, [items, assign]);

  const totals = Array.from({ length: guestCount }, (_, g) => {
    const mine = rows.filter((l) => l.guest === g);
    const t = calculateBill(
      mine.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity, complimentary: byId.get(l.itemId)?.complimentary ?? false })),
      { discount: { kind: "none" }, serviceChargeBps: config.serviceChargeBps, vatMode: config.vatMode, vatBps: config.vatBps, vatAppliesToServiceCharge: config.vatAppliesToServiceCharge, roundToRupee: config.roundToRupee },
    );
    return { lines: mine, sub: guestSubtotal(rows, g), total: t.grandTotal, empty: mine.length === 0 };
  });

  const toggle = (itemId: string, unit: number, g: number) =>
    setAssign((all) =>
      all.map((a) => {
        if (a.itemId !== itemId) return a;
        const it = byId.get(itemId)!;
        const canShare = it.status === "SERVED";
        const units = a.units.map((u, i) => {
          if (i !== unit) return u;
          if (!canShare) return [g]; // a dish still being made goes to one guest
          const has = u.includes(g);
          if (has) return u.length === 1 ? u : u.filter((x) => x !== g);
          return [...u, g].sort((x, y) => x - y);
        });
        return { ...a, units };
      }),
    );
  const only = (itemId: string, unit: number, g: number) => setAssign((all) => all.map((a) => (a.itemId === itemId ? { ...a, units: a.units.map((u, i) => (i === unit ? [g] : u)) } : a)));

  const setCount = (n: number) => {
    const next = Math.min(MAX_GUESTS, Math.max(2, n));
    setLabels((l) => (next > l.length ? [...l, ...Array.from({ length: next - l.length }, (_, i) => `Guest ${l.length + i + 1}`)] : l.slice(0, next)));
    setAssign((a) => dropGuests(a, next));
  };

  // Dishes already served are shared by everyone; ones still being made go round the guests one each (they cannot be shared yet).
  const shareAll = () => {
    const all = Array.from({ length: guestCount }, (_, g) => g);
    setAssign(items.map((it) => ({ itemId: it.id, units: Array.from({ length: it.quantity }, (_, u) => (it.status === "SERVED" ? [...all] : [u % guestCount])) })));
  };

  const payload = JSON.stringify({ guests: labels.map((l, i) => ({ label: l.trim() || `Guest ${i + 1}` })), assignments: assign });
  const grand = totals.reduce((n, t) => n + t.total, 0);
  const btn = "min-h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium hover:bg-stone-50";

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="plan" value={payload} />

      <section className="card space-y-3 p-4" aria-label="Guests">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto font-semibold">Guests</h2>
          <button type="button" className={btn} onClick={() => setCount(guestCount - 1)} disabled={guestCount <= 2} aria-label="One guest fewer">
            −
          </button>
          <span className="w-6 text-center font-semibold tabular-nums">{guestCount}</span>
          <button type="button" className={btn} onClick={() => setCount(guestCount + 1)} disabled={guestCount >= MAX_GUESTS} aria-label="One guest more">
            +
          </button>
          <button type="button" className={btn} onClick={shareAll}>
            Share everything equally
          </button>
          <button type="button" className={btn} onClick={() => setAssign(everythingOnFirst(items))}>
            Start again
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {labels.map((l, g) => (
            <label key={g} className="text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <span className={`size-3 rounded-full ${CHIP[g]}`} aria-hidden="true" /> {g === 0 ? "This bill" : `Bill ${g + 1}`}
              </span>
              <input value={l} maxLength={30} onChange={(e) => setLabels((all) => all.map((x, i) => (i === g ? e.target.value : x)))} className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <section className="card divide-y divide-stone-100 p-0" aria-label="Items">
          {items.map((it) => {
            const a = assign.find((x) => x.itemId === it.id)!;
            const canShare = it.status === "SERVED";
            return (
              <div key={it.id} className="p-4">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{it.name}</span>
                  <span className="text-sm text-stone-500">
                    {formatNpr(it.unitPrice)} each{it.quantity > 1 ? ` · ${it.quantity} on the bill` : ""}
                    {it.note ? ` · ${it.note}` : ""}
                  </span>
                  {!canShare && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Not served yet: it can only go to one guest</span>}
                </p>
                <ul className="mt-2 space-y-2">
                  {a.units.map((u, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      {it.quantity > 1 && <span className="w-10 text-xs text-stone-500">#{i + 1}</span>}
                      <div role="group" aria-label={`${it.name}${it.quantity > 1 ? ` number ${i + 1}` : ""}: who has it`} className="flex flex-wrap gap-1.5">
                        {labels.map((_, g) => {
                          const on = u.includes(g);
                          return (
                            <button
                              key={g}
                              type="button"
                              aria-pressed={on}
                              onClick={() => toggle(it.id, i, g)}
                              onDoubleClick={() => only(it.id, i, g)}
                              className={`min-h-9 min-w-9 rounded-full px-3 text-sm font-medium ${on ? `${CHIP[g]} text-white` : "border border-stone-300 bg-white text-stone-600 hover:bg-stone-50"}`}
                              title={canShare ? "Tap to add or remove this guest. Several guests share it equally." : "This guest has it"}
                            >
                              {name(g)}
                            </button>
                          );
                        })}
                      </div>
                      {u.length > 1 && <span className="text-xs text-stone-500">shared by {u.length}: about {formatNpr(Math.round(it.unitPrice / u.length))} each</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>

        <aside className="space-y-3" aria-label="Each guest's bill">
          {totals.map((t, g) => (
            <div key={g} className={`card p-4 ${t.empty ? "border-red-300 bg-red-50" : ""}`}>
              <h3 className="flex items-center gap-2 font-semibold">
                <span className={`size-3 rounded-full ${CHIP[g]}`} aria-hidden="true" /> {name(g)}
              </h3>
              {t.empty ? (
                <p className="mt-1 text-sm text-red-800">Nothing on this bill yet.</p>
              ) : (
                <>
                  <ul className="mt-1 space-y-0.5 text-sm text-stone-600">
                    {t.lines.map((l, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {l.quantity} × {shareName(byId.get(l.itemId)?.name ?? "", l.shareDen)}
                        </span>
                        <span className="tabular-nums">{formatNpr(l.quantity * l.unitPrice)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 flex items-baseline justify-between border-t border-stone-100 pt-2">
                    <span className="text-sm text-stone-500">With service charge and VAT</span>
                    <strong className="text-lg tabular-nums">{formatNpr(t.total)}</strong>
                  </p>
                </>
              )}
            </div>
          ))}
          <p className="text-xs text-stone-500">
            Total of all bills {formatNpr(grand)}, before any discount. Each bill is rounded on its own when it is paid, so this can differ from the original bill by a few paisa. A combo or happy-hour deal is worked out again on each bill.
          </p>
        </aside>
      </div>

      {plan.error && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {plan.error}
        </p>
      )}
      <button className="btn-primary" disabled={!plan.lines}>
        Make {guestCount} bills
      </button>
    </form>
  );
}
