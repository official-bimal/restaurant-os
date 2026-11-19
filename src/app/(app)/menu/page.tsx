import Link from "next/link";
import { DishPhoto } from "./dish-photo";
import { requireTenant } from "@/server/auth";
import { getMenuAdmin } from "@/features/menu/server/service";
import { formatNpr } from "@/features/billing/calc";
import { MenuTabs } from "@/components/menu-tabs";
import {
  createCategoryAction,
  createItemAction,
  createStationAction,
  deleteCategoryAction,
  deleteItemAction,
  deleteStationAction,
  renameCategoryAction,
  setAvailableAction,
  updateItemAction,
} from "./actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";
const smallBtn = "min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50";

type Station = { id: string; name: string };
type Category = { id: string; name: string };

function ItemFields({
  categories,
  stations,
  defaults,
}: {
  categories: Category[];
  stations: Station[];
  defaults?: { categoryId: string; stationId: string | null; name: string; nameNe: string | null; price: number; prepMinutes: number };
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium sm:col-span-2">
        Name
        <input name="name" required maxLength={80} defaultValue={defaults?.name} className={input} />
      </label>
      <label className="text-sm font-medium sm:col-span-2">
        Nepali name <span className="font-normal text-stone-500">(optional, shown to guests who choose Nepali)</span>
        <input name="nameNe" lang="ne" maxLength={80} defaultValue={defaults?.nameNe ?? ""} placeholder="जस्तै: बफ मोमो" className={input} />
      </label>
      <label className="text-sm font-medium">
        Price (Rs)
        <input
          name="priceRupees"
          type="number"
          min={0}
          step="0.01"
          required
          defaultValue={defaults ? (defaults.price / 100).toFixed(2) : undefined}
          className={input}
        />
      </label>
      <label className="text-sm font-medium">
        Prep time (minutes)
        <input name="prepMinutes" type="number" min={1} max={240} required defaultValue={defaults?.prepMinutes ?? 15} className={input} />
      </label>
      <label className="text-sm font-medium">
        Category
        <select name="categoryId" required defaultValue={defaults?.categoryId} className={input}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium">
        Kitchen station
        <select name="stationId" defaultValue={defaults?.stationId ?? ""} className={input}>
          <option value="">None</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export default async function MenuPage({ searchParams }: PageProps<"/menu">) {
  const ctx = await requireTenant("menu.manage");
  const { error } = await searchParams;
  const { categories, stations } = await getMenuAdmin(ctx);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Menu</h1>
        <Link href="/menu/photos" className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm">
          Add many photos at once
        </Link>
      </div>
      <MenuTabs current="dishes" />

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <form action={createCategoryAction} className="flex items-end gap-2 rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <label className="flex-1 text-sm font-medium">
            New category
            <input name="name" required maxLength={80} placeholder="e.g. Desserts" className={input} />
          </label>
          <label className="flex-1 text-sm font-medium">
            Nepali name
            <input name="nameNe" lang="ne" maxLength={80} placeholder="जस्तै: मिठाई" className={input} />
          </label>
          <button className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Add</button>
        </form>
        <div className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <form action={createStationAction} className="flex items-end gap-2">
            <label className="flex-1 text-sm font-medium">
              Kitchen stations
              <input name="name" required maxLength={80} placeholder="e.g. Grill" className={input} />
            </label>
            <button className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Add</button>
          </form>
          <ul className="mt-2 flex flex-wrap gap-2">
            {stations.map((s) => (
              <li key={s.id} className="flex items-center gap-1 rounded-full bg-stone-100 py-1 pl-3 pr-1 text-sm">
                {s.name}
                <form action={deleteStationAction.bind(null, s.id)}>
                  <button aria-label={`Delete station ${s.name}`} className="h-6 w-6 rounded-full text-stone-500 hover:bg-stone-200">
                    ×
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {categories.length > 0 && (
        <details className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <summary className="cursor-pointer font-medium">Add a dish</summary>
          <form action={createItemAction} className="mt-3 space-y-3">
            <ItemFields categories={categories} stations={stations} />
            <button className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Add dish</button>
          </form>
        </details>
      )}

      {categories.length === 0 && <p className="text-stone-500">Add a category first, then add dishes to it.</p>}

      {categories.map((cat) => (
        <section key={cat.id} className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-lg font-semibold">{cat.name}</h2>
            <details className="relative">
              <summary className={`${smallBtn} flex cursor-pointer items-center`}>Rename</summary>
              <form
                action={renameCategoryAction.bind(null, cat.id)}
                className="absolute right-0 z-10 mt-1 flex w-80 gap-2 rounded-lg bg-white p-3 shadow border border-stone-200 shadow-sm"
              >
                <input name="name" required maxLength={80} defaultValue={cat.name} aria-label="Category name" className={input} />
                <input name="nameNe" lang="ne" maxLength={80} defaultValue={cat.nameNe ?? ""} aria-label="Category name in Nepali" placeholder="नेपालीमा" className={input} />
                <button className={smallBtn}>Save</button>
              </form>
            </details>
            <form action={deleteCategoryAction.bind(null, cat.id)}>
              <button className={`${smallBtn} text-red-700`} disabled={cat.items.length > 0} title={cat.items.length > 0 ? "Remove its dishes first" : undefined}>
                Delete
              </button>
            </form>
          </div>

          {cat.items.length === 0 ? (
            <p className="text-sm text-stone-500">No dishes yet.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {cat.items.map((item) => {
                const station = stations.find((s) => s.id === item.stationId);
                return (
                  <li key={item.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`min-w-0 flex-1 ${item.available ? "" : "text-stone-400 line-through"}`}>
                        {item.name}
                        <span className="ml-2 text-xs text-stone-500">
                          {station ? station.name : "no station"} · {item.prepMinutes} min
                        </span>
                      </span>
                      <span className="text-sm">{formatNpr(item.price)}</span>
                      {!item.available && <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs">unavailable</span>}
                      <form action={setAvailableAction.bind(null, item.id, !item.available)}>
                        <button className={smallBtn}>{item.available ? "Mark unavailable" : "Mark available"}</button>
                      </form>
                      <form action={deleteItemAction.bind(null, item.id)}>
                        <button
                          className={`${smallBtn} text-red-700 disabled:text-stone-400`}
                          disabled={item._count.orderItems > 0}
                          title={item._count.orderItems > 0 ? "Ordered before: mark unavailable instead" : undefined}
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                    <div className="mt-2">
                      <DishPhoto itemId={item.id} name={item.name} version={item.image ? item.image.updatedAt.getTime() : null} />
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-sm text-stone-600">Edit</summary>
                      <form action={updateItemAction.bind(null, item.id)} className="mt-2 space-y-3 rounded-lg bg-stone-50 p-3">
                        <ItemFields
                          categories={categories}
                          stations={stations}
                          defaults={{
                            categoryId: item.categoryId,
                            stationId: item.stationId,
                            name: item.name,
                            nameNe: item.nameNe,
                            price: item.price,
                            prepMinutes: item.prepMinutes,
                          }}
                        />
                        <button className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Save changes</button>
                        <p className="text-xs text-stone-500">Orders already taken keep the old name and price.</p>
                      </form>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
