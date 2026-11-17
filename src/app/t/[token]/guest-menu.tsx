"use client";

import { randomKey } from "@/lib/random-key";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatNpr } from "@/features/billing/calc";
import { attachNumberAction, requestServiceAction, submitOrderAction } from "./actions";
import { useLang, useT } from "./lang";
import type { StringKey } from "@/features/guest/i18n";

export interface GuestGroup {
  id: string;
  name: string;
  required: boolean;
  multiple: boolean;
  choices: { id: string; name: string; price: number }[];
}
export interface GuestItem {
  id: string;
  name: string;
  /** Optional Nepali name. */
  nameNe?: string | null;
  price: number;
  groups: GuestGroup[];
  /** Among the dishes sold most lately. Only a label: guests never see how many were sold. */
  bestSeller?: boolean;
  /** Average stars from guests, only once enough have rated it. */
  rating?: { average: number; count: number } | null;
  /** When the dish's photo was last changed (used in the address so a new photo shows at once), or null for no photo. */
  photo?: number | null;
}
export interface MenuCategory {
  id: string;
  name: string;
  nameNe?: string | null;
  items: GuestItem[];
}

/** One line in the cart: a dish and the choices made on it. The same dish with other choices is another line. */
interface CartLine {
  itemId: string;
  addOnIds: string[];
  quantity: number;
}
const lineKey = (itemId: string, addOnIds: string[]) => `${itemId}|${[...addOnIds].sort().join(",")}`;

export function GuestMenu({ token, categories }: { token: string; categories: MenuCategory[] }) {
  const router = useRouter();
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  // The dish whose choices are open, and what has been ticked so far (group id to choice ids).
  const [picking, setPicking] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [pickError, setPickError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<string>("all");
  // Language chosen with the switch at the top of the page (shared with every other part of the guest page).
  const [lang] = useLang();
  const t = useT();
  // One key per cart. A second tap, or a retry after a bad connection, reuses it and cannot make a duplicate.
  const key = useRef(randomKey());

  const real = categories.filter((c) => c.id !== BEST && c.items.length > 0);
  const best = categories.find((c) => c.id === BEST);
  const all = real.flatMap((c) => c.items);
  const priceOf = (item: GuestItem, addOnIds: string[]) =>
    item.price + item.groups.flatMap((g) => g.choices).filter((c) => addOnIds.includes(c.id)).reduce((n, c) => n + c.price, 0);
  const lines = Object.entries(cart)
    .filter(([, l]) => l.quantity > 0)
    .map(([k, l]) => ({ k, line: l, item: all.find((i) => i.id === l.itemId)! }))
    .filter((l) => l.item);
  const count = lines.reduce((s, l) => s + l.line.quantity, 0);
  const total = lines.reduce((s, l) => s + priceOf(l.item, l.line.addOnIds) * l.line.quantity, 0);
  const dish = (i: { name: string; nameNe?: string | null }) => (lang === "ne" && i.nameNe ? i.nameNe : i.name);
  const catName = (c: MenuCategory) => (c.id === BEST ? t("bestSelling") : lang === "ne" && c.nameNe ? c.nameNe : c.name);
  const plainQty = (id: string) => cart[lineKey(id, [])]?.quantity ?? 0;

  const change = (itemId: string, addOnIds: string[], delta: number) => {
    setSent(false);
    const k = lineKey(itemId, addOnIds);
    setCart((c) => ({ ...c, [k]: { itemId, addOnIds, quantity: Math.max(0, Math.min(20, (c[k]?.quantity ?? 0) + delta)) } }));
  };

  const openPicker = (item: GuestItem) => {
    // Start from the first choice of every required single-choice group, so the common order is one tap.
    const start: Record<string, string[]> = {};
    for (const g of item.groups) if (g.required && !g.multiple && g.choices[0]) start[g.id] = [g.choices[0].id];
    setPicks(start);
    setPickError(null);
    setPicking(item.id);
  };

  const togglePick = (g: GuestGroup, choiceId: string) => {
    setPicks((p) => {
      const cur = p[g.id] ?? [];
      if (g.multiple) return { ...p, [g.id]: cur.includes(choiceId) ? cur.filter((x) => x !== choiceId) : [...cur, choiceId] };
      return { ...p, [g.id]: [choiceId] };
    });
  };

  const confirmPick = (item: GuestItem) => {
    const missing = item.groups.find((g) => g.required && (picks[g.id] ?? []).length === 0);
    if (missing) {
      setPickError(t("pleaseChoose", { group: missing.name }));
      return;
    }
    change(item.id, Object.values(picks).flat(), 1);
    setPicking(null);
  };

  const place = () => {
    if (pending || lines.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await submitOrderAction(token, {
        idempotencyKey: key.current,
        note: note.trim() || undefined,
        items: lines.map((l) => ({ menuItemId: l.item.id, quantity: l.line.quantity, addOnIds: l.line.addOnIds })),
      });
      if (res.ok) {
        setCart({});
        setNote("");
        setSent(true);
        key.current = randomKey(); // next cart gets its own key
        router.refresh();
      } else {
        setError(res.error ?? "Something went wrong. Please try again.");
      }
    });
  };

  const stepper = (label: string, qty: number, onChange: (d: number) => void) => (
    <div className="flex items-center justify-between gap-2">
      <button onClick={() => onChange(-1)} aria-label={`Remove one ${label}`} className="h-10 w-10 rounded-full bg-white/10 text-xl">
        −
      </button>
      <span className="w-6 text-center font-semibold" aria-live="polite">
        {qty}
      </span>
      <button onClick={() => onChange(1)} aria-label={`Add one more ${label}`} className="h-10 w-10 rounded-full bg-brand-600 text-xl text-white hover:bg-brand-700">
        +
      </button>
    </div>
  );

  const card = (item: GuestItem, inBest: boolean) => {
    const hasChoices = item.groups.length > 0;
    const inCart = lines.filter((l) => l.item.id === item.id);
    return (
      <li key={`${inBest ? "b" : "c"}-${item.id}`} className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-white/5">
        <div className="relative aspect-[4/3] w-full" style={{ background: tileBackground(item.name) }} aria-hidden="true">
          <span className="absolute inset-0 grid place-items-center text-5xl font-bold text-white/70">{dish(item).trim().charAt(0).toUpperCase()}</span>
          {item.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/dish/${item.id}?v=${item.photo}`} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}
          {item.rating && (
            <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">★ {item.rating.average}</span>
          )}
          {item.bestSeller && !inBest && (
            <span className="absolute right-2 top-2 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white">{t("bestSellerBadge")}</span>
          )}
        </div>
        <div className="flex flex-1 flex-col p-3">
          <p className="line-clamp-2 min-h-10 font-semibold leading-tight" lang={lang === "ne" && item.nameNe ? "ne" : undefined}>
            {dish(item)}
          </p>
          <p className="mt-0.5 text-sm text-stone-500">
            {hasChoices ? t("fromPrice", { price: formatNpr(item.price) }) : formatNpr(item.price)}
          </p>
          <div className="mt-2">
            {hasChoices ? (
              <button
                onClick={() => openPicker(item)}
                aria-label={`Choose options for ${item.name}`}
                className="min-h-11 w-full rounded-full bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700"
              >
                {t("add")}
              </button>
            ) : plainQty(item.id) === 0 ? (
              <button
                onClick={() => change(item.id, [], 1)}
                aria-label={`Add ${item.name}`}
                className="min-h-11 w-full rounded-full bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700"
              >
                {t("add")}
              </button>
            ) : (
              stepper(item.name, plainQty(item.id), (d) => change(item.id, [], d))
            )}
          </div>
          {hasChoices &&
            inCart.map((l) => {
              const names = item.groups.flatMap((g) => g.choices).filter((c) => l.line.addOnIds.includes(c.id)).map((c) => c.name);
              return (
                <div key={l.k} className="mt-2 border-t border-stone-100 pt-2">
                  <p className="mb-1 text-xs text-stone-600">
                    {names.length ? names.join(", ") : t("plain")} · {formatNpr(priceOf(item, l.line.addOnIds))}
                  </p>
                  {stepper(`${item.name} (${names.join(", ") || "plain"})`, l.line.quantity, (d) => change(item.id, l.line.addOnIds, d))}
                </div>
              );
            })}
        </div>
      </li>
    );
  };

  const grid = (items: GuestItem[], inBest = false) => <ul className="grid grid-cols-2 gap-3">{items.map((i) => card(i, inBest))}</ul>;

  const q = query.trim().toLowerCase();
  const matches = q ? all.filter((i) => i.name.toLowerCase().includes(q) || (i.nameNe ?? "").toLowerCase().includes(q)) : [];
  const pickItem = picking ? all.find((i) => i.id === picking) : undefined;
  const tabs: { id: string; label: string }[] = [
    { id: "all", label: t("allItems") },
    ...(best ? [{ id: BEST, label: t("bestSelling") }] : []),
    ...real.map((c) => ({ id: c.id, label: catName(c) })),
  ];

  return (
    <div className="pb-32">
      <div className="sticky top-0 z-10 -mx-4 space-y-3 bg-[#121212]/95 px-4 pb-3 pt-1 backdrop-blur">
        <label className="relative block">
          <span className="sr-only">{t("searchDishes")}</span>
          <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-stone-500">
            ⌕
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchDishes")}
            maxLength={60}
            className="block min-h-12 w-full rounded-full py-2 pl-10 pr-4 text-base"
          />
        </label>
        {!q && (
          <div role="tablist" aria-label="Menu categories" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-medium ${
                  tab === t.id ? "bg-brand-600 text-white" : "bg-white text-stone-600 ring-1 ring-white/10"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {q ? (
        matches.length === 0 ? (
          <p className="py-10 text-center text-stone-500">{t("noMatch", { q: query.trim() })}</p>
        ) : (
          grid(matches)
        )
      ) : tab === "all" ? (
        <>
          {best && (
            <section className="mb-6">
              <h2 className="mb-2 text-lg font-semibold">{t("bestSelling")}</h2>
              {grid(best.items, true)}
            </section>
          )}
          {real.map((cat) => (
            <section key={cat.id} className="mb-6">
              <h2 className="mb-2 text-lg font-semibold">{catName(cat)}</h2>
              {grid(cat.items)}
            </section>
          ))}
        </>
      ) : (
        (() => {
          const cat = tab === BEST ? best : real.find((c) => c.id === tab);
          return cat ? grid(cat.items, tab === BEST) : null;
        })()
      )}

      {pickItem && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={() => setPicking(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Options for ${pickItem.name}`}
            className="mx-auto max-h-[85vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-t-3xl bg-white p-4 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{dish(pickItem)}</p>
                <p className="text-sm text-stone-500">{t("fromPrice", { price: formatNpr(pickItem.price) })}</p>
              </div>
              <button onClick={() => setPicking(null)} aria-label={t("close")} className="h-10 w-10 rounded-full bg-white/10 text-xl">
                ×
              </button>
            </div>
            {pickItem.groups.map((g) => (
              <fieldset key={g.id}>
                <legend className="text-sm font-medium">
                  {g.name} <span className="text-xs font-normal text-stone-500">{g.required ? t("chooseOne") : g.multiple ? t("optionalPickAny") : t("optional")}</span>
                </legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {g.choices.map((c) => {
                    const on = (picks[g.id] ?? []).includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm ${on ? "border-brand-600 bg-brand-50" : "border-stone-300"}`}
                      >
                        <input
                          type={g.multiple ? "checkbox" : "radio"}
                          name={`${pickItem.id}-${g.id}`}
                          checked={on}
                          onChange={() => togglePick(g, c.id)}
                        />
                        {c.name}
                        {c.price > 0 && <span className="text-xs text-stone-500">+{formatNpr(c.price)}</span>}
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
            <button onClick={() => confirmPick(pickItem)} className="min-h-12 w-full rounded-full bg-brand-600 font-semibold text-white hover:bg-brand-700">
              {t("addToOrder")}
            </button>
          </div>
        </div>
      )}

      {(count > 0 || error || sent) && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white p-3 shadow-lg">
          <div className="mx-auto max-w-lg space-y-2">
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800">
                {error}
              </p>
            )}
            {sent && count === 0 && (
              <p role="status" className="rounded-lg bg-green-50 p-2 text-sm text-green-800">
                {t("orderSent")}
              </p>
            )}
            {count > 0 && (
              <>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={120}
                  placeholder={t("notePlaceholder")}
                  aria-label="Note for the kitchen"
                  className="w-full px-3 py-2"
                />
                <button
                  onClick={place}
                  disabled={pending}
                  className="min-h-12 w-full rounded-full bg-brand-600 px-4 text-lg font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {pending ? t("sending") : t("placeOrder", { count: count === 1 ? t("itemOne") : t("itemMany", { n: count }), total: formatNpr(total) })}
                </button>
                <p className="text-center text-xs text-stone-500">{t("serviceTaxAdded")}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const BEST = "best-selling";

/** A calm coloured tile for a dish with no photo: the colour comes from the name, so a dish always looks the same. */
function tileBackground(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${h} 38% 30%), hsl(${(h + 35) % 360} 42% 18%))`;
}

const SERVICE = [
  { kind: "CALL_WAITER", label: "callWaiter", asked: "waiterComing" },
  { kind: "WATER", label: "water", asked: "waterComing" },
  { kind: "REQUEST_BILL", label: "requestBill", asked: "billRequested" },
] as const satisfies readonly { kind: string; label: StringKey; asked: StringKey }[];

export function ServiceButtons({ token, open }: { token: string; open: string[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ask = (kind: (typeof SERVICE)[number]["kind"]) => {
    setError(null);
    startTransition(async () => {
      const res = await requestServiceAction(token, kind);
      if (res.error) setError(res.error);
      router.refresh();
    });
  };

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {SERVICE.map((s) => {
          const asked = open.includes(s.kind);
          return (
            <button
              key={s.kind}
              onClick={() => ask(s.kind)}
              disabled={pending || asked}
              className="min-h-12 rounded-xl border border-stone-300 bg-white px-2 text-sm font-medium disabled:bg-stone-100 disabled:text-stone-500"
            >
              {asked ? t(s.asked) : t(s.label)}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

/** Optional: say whose points this visit earns. Never shows anything about an existing customer. */
export function GuestLoyalty({
  token,
  maskedPhone,
  pointsToEarn,
}: {
  token: string;
  maskedPhone: string | null;
  pointsToEarn: number;
}) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(!maskedPhone);
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await attachNumberAction(token, { phone, marketingConsent: consent });
      if (res.ok) {
        setEditing(false);
        setPhone("");
        router.refresh();
      } else {
        setError(res.error ?? "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <section aria-label="Earn points" className="mb-5 rounded-xl bg-green-50 p-3 ring-1 ring-green-200">
      <h2 className="font-semibold">{t("earnPoints")}</h2>
      {maskedPhone && !editing ? (
        <div className="mt-1 text-sm">
          <p>
            {t("pointsGoTo", { phone: maskedPhone })}
            {pointsToEarn > 0 && <> {t("billWorth", { points: pointsToEarn })}</>}
          </p>
          <button onClick={() => setEditing(true)} className="mt-1 text-green-900 underline">
            {t("useDifferent")}
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          <label className="block font-medium">
            {t("yourPhone")}
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="98XXXXXXXX"
              maxLength={30}
              className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base"
            />
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4" />
            <span>{t("offersConsent")}</span>
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-2 text-red-800">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={pending || phone.trim().length === 0}
              className="min-h-11 rounded-lg bg-green-700 px-4 font-medium text-white disabled:opacity-60"
            >
              {pending ? t("saving") : t("saveNumber")}
            </button>
            {maskedPhone && (
              <button onClick={() => setEditing(false)} className="text-stone-600 underline">
                {t("cancel")}
              </button>
            )}
          </div>
          <p className="text-xs text-stone-600">
            {t("numberUse")}
          </p>
        </div>
      )}
    </section>
  );
}
