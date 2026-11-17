import { requireTenant } from "@/server/auth";
import { formatNpr } from "@/features/billing/calc";
import { listAddOnGroups } from "@/features/menu/server/addons";
import { getMenuAdmin } from "@/features/menu/server/service";
import { listStock } from "@/features/stock/server/service";
import { MenuTabs } from "@/components/menu-tabs";
import {
  archiveAddOnAction,
  archiveGroupAction,
  createAddOnAction,
  createGroupAction,
  setAddOnStockAction,
  setGroupItemsAction,
  updateAddOnAction,
  updateGroupAction,
} from "./actions";

export const dynamic = "force-dynamic";

const field = "min-h-10 px-3 text-sm";
const smallBtn = "min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50";

export default async function ExtrasPage({ searchParams }: PageProps<"/menu/extras">) {
  const ctx = await requireTenant("menu.manage");
  const { error } = await searchParams;
  const [groups, menu, stock] = await Promise.all([listAddOnGroups(ctx), getMenuAdmin(ctx), listStock(ctx)]);
  const dishes = menu.categories.flatMap((c) => c.items.map((i) => ({ id: i.id, name: i.name, category: c.name })));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Menu</h1>
      <MenuTabs current="extras" />
      <p className="text-sm text-stone-600">
        Add-ons let a waiter pick a size or extras when taking an order, for example &ldquo;Size: Small / Large&rdquo; or
        &ldquo;Extras: cheese, egg&rdquo;. The extra price is added to that line and shows on the kitchen ticket. Guests ordering from
        their phone see the same choices. An add-on can also use stock (an extra egg, a bigger cup), which is taken off when the bill is paid.
      </p>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <form action={createGroupAction} className="card flex flex-wrap items-end gap-4 p-4">
        <label className="text-sm font-medium">
          New group
          <input name="name" required maxLength={60} placeholder="e.g. Size" className={`mt-1 block ${field}`} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="required" /> Must choose
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="multiple" /> Can pick several
        </label>
        <button className="btn-primary">Add group</button>
      </form>

      {groups.length === 0 && <p className="text-stone-500">No groups yet. Add one above, then add its choices.</p>}

      {groups.map((g) => (
        <section key={g.id} className="card space-y-4 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <form action={updateGroupAction.bind(null, g.id)} className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium">
                Group
                <input name="name" defaultValue={g.name} required maxLength={60} className={`mt-1 block ${field}`} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="required" defaultChecked={g.required} /> Must choose
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="multiple" defaultChecked={g.multiple} /> Can pick several
              </label>
              <button className={smallBtn}>Save</button>
            </form>
            <form action={archiveGroupAction.bind(null, g.id)}>
              <button className={`${smallBtn} text-red-700`}>Remove group</button>
            </form>
          </div>

          <ul className="divide-y divide-stone-100">
            {g.addOns.map((a) => (
              <li key={a.id} className="flex flex-wrap items-end gap-3 py-2">
                <form action={updateAddOnAction.bind(null, a.id)} className="flex flex-wrap items-end gap-2">
                  <input name="name" defaultValue={a.name} required maxLength={60} aria-label="Choice name" className={field} />
                  <label className="flex items-center gap-1 text-sm text-stone-500">
                    +Rs
                    <input
                      name="price"
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={a.price / 100}
                      aria-label={`Extra price for ${a.name}`}
                      className={`w-24 ${field}`}
                    />
                  </label>
                  <button className={smallBtn}>Save</button>
                </form>
                <span className="text-sm text-stone-500">{a.price ? `+${formatNpr(a.price)}` : "free"}</span>
                <form action={archiveAddOnAction.bind(null, a.id)}>
                  <button className="text-xs text-red-700 underline">Remove</button>
                </form>
                {stock.length > 0 && (
                  <details className="basis-full">
                    <summary className="cursor-pointer text-xs font-medium text-stone-600">
                      Stock used{a.stock.length ? ` (${a.stock.length})` : ""}
                    </summary>
                    <form action={setAddOnStockAction.bind(null, a.id)} className="mt-2 space-y-2 rounded-xl bg-stone-50 p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        {stock.map((st) => (
                          <label key={st.id} className="flex items-center justify-between gap-2 text-sm">
                            <span>{st.name}</span>
                            <span className="flex items-center gap-1">
                              <input
                                name={`stock_${st.id}`}
                                type="number"
                                min={0}
                                step={1}
                                defaultValue={a.stock.find((x) => x.stockItemId === st.id)?.quantity ?? ""}
                                aria-label={`${st.name} used by ${a.name}`}
                                className="w-24 min-h-9 px-2 text-sm"
                              />
                              <span className="w-8 text-xs text-stone-500">{st.unit}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <button className="min-h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm hover:bg-stone-50">Save stock use</button>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>

          <form action={createAddOnAction.bind(null, g.id)} className="flex flex-wrap items-end gap-2 rounded-xl bg-stone-50 p-3">
            <label className="text-sm font-medium">
              New choice
              <input name="name" required maxLength={60} placeholder="e.g. Large" className={`mt-1 block ${field}`} />
            </label>
            <label className="text-sm font-medium">
              Extra price (Rs)
              <input name="price" type="number" min={0} step="0.01" defaultValue={0} className={`mt-1 block w-28 ${field}`} />
            </label>
            <button className={smallBtn}>Add choice</button>
          </form>

          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Dishes that use this group ({g.items.length})
            </summary>
            <form action={setGroupItemsAction.bind(null, g.id)} className="mt-2 space-y-3">
              <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {dishes.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-stone-50">
                    <input type="checkbox" name="item" value={d.id} defaultChecked={g.items.some((i) => i.menuItemId === d.id)} />
                    <span>{d.name}</span>
                    <span className="text-xs text-stone-400">{d.category}</span>
                  </label>
                ))}
              </div>
              <button className="btn-primary">Save dishes</button>
            </form>
          </details>
        </section>
      ))}
    </div>
  );
}
