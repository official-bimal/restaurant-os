"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatNpr } from "@/features/billing/calc";
import { addItemsAction } from "../actions";

export interface PickerGroup {
  id: string;
  name: string;
  required: boolean;
  multiple: boolean;
  choices: { id: string; name: string; price: number }[];
}
export interface PickerItem {
  id: string;
  name: string;
  price: number;
  /** When the dish's photo last changed (so a new photo shows at once), or null for none. */
  photo: number | null;
  groups: PickerGroup[];
}
export interface PickerCategory {
  id: string;
  name: string;
  items: PickerItem[];
}

interface Line {
  itemId: string;
  addOnIds: string[];
  quantity: number;
}
const lineKey = (itemId: string, addOnIds: string[]) => `${itemId}|${[...addOnIds].sort().join(",")}`;

/** A calm coloured tile with the dish's first letter, for a dish with no photo. The colour comes from the name, so it never changes. */
function tileColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${h} 45% 38%), hsl(${(h + 40) % 360} 45% 24%))`;
}

function Thumb({ item }: { item: PickerItem }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl text-2xl font-bold text-white/80" style={{ background: tileColor(item.name) }} aria-hidden="true">
      {item.name.trim().charAt(0).toUpperCase()}
      {item.photo && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/dish/${item.id}?v=${item.photo}`} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="absolute inset-0 size-full object-cover" />
      ) : null}
    </span>
  );
}

/**
 * Taking an order on a phone: pick dishes from a list with big + and − buttons, and send them all in one tap. Nothing reloads while
 * picking (the old way sent the page back to the top after every dish). Dishes with choices (size, extras) ask first.
 */
export function OrderMenu({ orderId, categories }: { orderId: string; categories: PickerCategory[] }) {
  const router = useRouter();
  const [cart, setCart] = useState<Record<string, Line>>({});
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [pickError, setPickError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const real = categories.filter((c) => c.items.length > 0);
  const all = real.flatMap((c) => c.items);
  const priceOf = (item: PickerItem, addOnIds: string[]) => item.price + item.groups.flatMap((g) => g.choices).filter((c) => addOnIds.includes(c.id)).reduce((n, c) => n + c.price, 0);
  const lines = Object.entries(cart)
    .filter(([, l]) => l.quantity > 0)
    .map(([k, line]) => ({ k, line, item: all.find((i) => i.id === line.itemId)! }))
    .filter((l) => l.item);
  const count = lines.reduce((n, l) => n + l.line.quantity, 0);
  const total = lines.reduce((n, l) => n + priceOf(l.item, l.line.addOnIds) * l.line.quantity, 0);

  const change = (itemId: string, addOnIds: string[], delta: number) => {
    setMessage(null);
    const k = lineKey(itemId, addOnIds);
    setCart((c) => ({ ...c, [k]: { itemId, addOnIds, quantity: Math.max(0, Math.min(99, (c[k]?.quantity ?? 0) + delta)) } }));
  };
  const plainQty = (id: string) => cart[lineKey(id, [])]?.quantity ?? 0;

  const openPicker = (item: PickerItem) => {
    // Start from the first choice of every required single-choice group, so the usual order is one tap.
    const start: Record<string, string[]> = {};
    for (const g of item.groups) if (g.required && !g.multiple && g.choices[0]) start[g.id] = [g.choices[0].id];
    setPicks(start);
    setPickError(null);
    setPicking(item.id);
  };
  const togglePick = (g: PickerGroup, id: string) =>
    setPicks((p) => {
      const cur = p[g.id] ?? [];
      return g.multiple ? { ...p, [g.id]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } : { ...p, [g.id]: [id] };
    });
  const confirmPick = (item: PickerItem) => {
    const missing = item.groups.find((g) => g.required && (picks[g.id] ?? []).length === 0);
    if (missing) return setPickError(`Please choose: ${missing.name}`);
    change(item.id, Object.values(picks).flat(), 1);
    setPicking(null);
  };

  const send = () => {
    if (pending || lines.length === 0) return;
    setMessage(null);
    start(async () => {
      const r = await addItemsAction(orderId, lines.map((l) => ({ menuItemId: l.item.id, quantity: l.line.quantity, addOnIds: l.line.addOnIds })));
      if (r.ok) {
        setCart({});
        setOpen(false);
        setMessage({ ok: true, text: `Added ${r.added} dish${r.added === 1 ? "" : "es"} to the order.` });
        router.refresh();
      } else setMessage({ ok: false, text: r.error });
    });
  };

  const stepper = (label: string, qty: number, onChange: (d: number) => void) => (
    <span className="flex items-center gap-1.5">
      <button type="button" onClick={() => onChange(-1)} aria-label={`Remove one ${label}`} className="size-11 rounded-full bg-stone-100 text-xl font-semibold text-stone-800 active:bg-stone-200">
        −
      </button>
      <span className="w-7 text-center text-base font-semibold" aria-live="polite">
        {qty}
      </span>
      <button type="button" onClick={() => onChange(1)} aria-label={`Add one more ${label}`} className="size-11 rounded-full bg-brand-600 text-xl font-semibold text-white active:bg-brand-700">
        +
      </button>
    </span>
  );

  const row = (item: PickerItem) => {
    const hasChoices = item.groups.length > 0;
    const mine = lines.filter((l) => l.item.id === item.id);
    return (
      <li key={item.id} className="py-3">
        <div className="flex items-center gap-3">
          <Thumb item={item} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-tight">{item.name}</p>
            <p className="text-sm text-stone-500">
              {hasChoices ? "from " : ""}
              {formatNpr(item.price)}
            </p>
          </div>
          {hasChoices ? (
            <button type="button" onClick={() => openPicker(item)} aria-label={`Choose options for ${item.name}`} className="min-h-11 rounded-full bg-brand-600 px-5 font-semibold text-white active:bg-brand-700">
              Add
            </button>
          ) : plainQty(item.id) === 0 ? (
            <button type="button" onClick={() => change(item.id, [], 1)} aria-label={`Add ${item.name}`} className="min-h-11 rounded-full bg-brand-600 px-5 font-semibold text-white active:bg-brand-700">
              Add
            </button>
          ) : (
            stepper(item.name, plainQty(item.id), (d) => change(item.id, [], d))
          )}
        </div>
        {hasChoices &&
          mine.map((l) => {
            const names = item.groups.flatMap((g) => g.choices).filter((c) => l.line.addOnIds.includes(c.id)).map((c) => c.name);
            return (
              <div key={l.k} className="ml-[4.75rem] mt-2 flex items-center justify-between gap-2 rounded-xl bg-stone-50 p-2">
                <span className="min-w-0 text-sm text-stone-600">
                  {names.length ? names.join(", ") : "Plain"} · {formatNpr(priceOf(item, l.line.addOnIds))}
                </span>
                {stepper(`${item.name} (${names.join(", ") || "plain"})`, l.line.quantity, (d) => change(item.id, l.line.addOnIds, d))}
              </div>
            );
          })}
      </li>
    );
  };

  const q = query.trim().toLowerCase();
  const matches = q ? all.filter((i) => i.name.toLowerCase().includes(q)) : [];
  const shown = tab === "all" ? real : real.filter((c) => c.id === tab);
  const pickItem = picking ? all.find((i) => i.id === picking) : undefined;

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-white/95 px-4 pb-2 pt-1 backdrop-blur">
        <label className="relative block">
          <span className="sr-only">Search dishes</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search dishes"
            maxLength={60}
            className="block min-h-11 w-full rounded-full border border-stone-300 px-4 py-2 text-base"
          />
        </label>
        {!q && (
          <div role="tablist" aria-label="Menu categories" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {[{ id: "all", name: "All" }, ...real].map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={tab === c.id}
                onClick={() => setTab(c.id)}
                className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-medium ${tab === c.id ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700"}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {q ? (
        matches.length === 0 ? (
          <p className="py-8 text-center text-stone-500">No dish matches &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          <ul className="divide-y divide-stone-100">{matches.map(row)}</ul>
        )
      ) : (
        shown.map((cat) => (
          <section key={cat.id} className="mb-2">
            {tab === "all" && <h3 className="mt-3 text-sm font-semibold uppercase tracking-wide text-stone-500">{cat.name}</h3>}
            <ul className="divide-y divide-stone-100">{cat.items.map(row)}</ul>
          </section>
        ))
      )}

      {pickItem && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={() => setPicking(null)}>
          <div role="dialog" aria-modal="true" aria-label={`Options for ${pickItem.name}`} className="mx-auto max-h-[85vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-t-3xl bg-white p-4 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{pickItem.name}</p>
                <p className="text-sm text-stone-500">from {formatNpr(pickItem.price)}</p>
              </div>
              <button type="button" onClick={() => setPicking(null)} aria-label="Close" className="size-10 rounded-full bg-stone-100 text-xl">
                ×
              </button>
            </div>
            {pickItem.groups.map((g) => (
              <fieldset key={g.id}>
                <legend className="text-sm font-medium">
                  {g.name} <span className="text-xs font-normal text-stone-500">{g.required ? "required" : "optional"}{g.multiple ? ", pick any" : ", pick one"}</span>
                </legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {g.choices.map((c) => {
                    const on = (picks[g.id] ?? []).includes(c.id);
                    return (
                      <label key={c.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm ${on ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300"}`}>
                        <input type={g.multiple ? "checkbox" : "radio"} name={`${pickItem.id}-${g.id}`} checked={on} onChange={() => togglePick(g, c.id)} className="sr-only" />
                        {c.name}
                        {c.price > 0 && <span className={`text-xs ${on ? "text-white/80" : "text-stone-500"}`}>+{formatNpr(c.price)}</span>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            {pickError && (
              <p role="alert" className="text-sm text-red-700">
                {pickError}
              </p>
            )}
            <button type="button" onClick={() => confirmPick(pickItem)} className="min-h-12 w-full rounded-full bg-brand-600 font-semibold text-white active:bg-brand-700">
              Add to list
            </button>
          </div>
        </div>
      )}

      {(count > 0 || message) && (
        // Sits above the phone's bottom tab bar, and at the bottom of the page on a computer.
        <div className="sticky bottom-[4.75rem] z-30 mt-3 space-y-2 lg:bottom-3">
          {message && (
            <p role={message.ok ? "status" : "alert"} className={`rounded-xl p-3 text-sm ${message.ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-800"}`}>
              {message.text}
            </p>
          )}
          {count > 0 && (
            <div className="rounded-2xl bg-stone-900 text-white shadow-lg">
              {open && (
                <ul className="max-h-60 divide-y divide-white/10 overflow-y-auto px-3 pt-2 text-sm">
                  {lines.map((l) => {
                    const names = l.item.groups.flatMap((g) => g.choices).filter((c) => l.line.addOnIds.includes(c.id)).map((c) => c.name);
                    return (
                      <li key={l.k} className="flex items-center justify-between gap-2 py-2">
                        <span className="min-w-0 flex-1">
                          {l.item.name}
                          {names.length > 0 && <span className="block text-xs text-white/60">{names.join(", ")}</span>}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <button type="button" onClick={() => change(l.item.id, l.line.addOnIds, -1)} aria-label={`Remove one ${l.item.name}`} className="size-9 rounded-full bg-white/15 text-lg">
                            −
                          </button>
                          <span className="w-6 text-center font-semibold">{l.line.quantity}</span>
                          <button type="button" onClick={() => change(l.item.id, l.line.addOnIds, 1)} aria-label={`Add one more ${l.item.name}`} className="size-9 rounded-full bg-white/15 text-lg">
                            +
                          </button>
                        </span>
                        <span className="w-20 text-right">{formatNpr(priceOf(l.item, l.line.addOnIds) * l.line.quantity)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex items-center gap-2 p-2">
                <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-h-11 flex-1 px-3 text-left">
                  <span className="font-semibold">
                    {count} item{count === 1 ? "" : "s"} selected
                  </span>
                  <span className="block text-sm text-white/70">
                    {formatNpr(total)} · {open ? "hide" : "view"} list
                  </span>
                </button>
                <button type="button" onClick={send} disabled={pending} className="min-h-12 rounded-xl bg-brand-600 px-5 font-semibold text-white active:bg-brand-700 disabled:opacity-60">
                  {pending ? "Adding…" : "Add to order"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
