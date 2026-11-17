import { requireTenant } from "@/server/auth";
import { db } from "@/server/db";
import { formatNpr } from "@/features/billing/calc";
import { getBranchAddOnAdmin, getBranchMenuAdmin } from "@/features/menu/server/branch-menu";
import { MenuTabs } from "@/components/menu-tabs";
import { saveBranchAddOnAction, saveBranchItemAction, setCategoryHiddenAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "min-h-9 px-2 text-sm";
const btn = "min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50";

export default async function BranchMenuPage({ searchParams }: PageProps<"/menu/branch">) {
  const ctx = await requireTenant("menu.manage");
  const { error } = await searchParams;
  const [menu, addOns, branch] = await Promise.all([
    getBranchMenuAdmin(ctx),
    getBranchAddOnAdmin(ctx),
    db.branch.findUniqueOrThrow({ where: { businessId_id: { businessId: ctx.businessId, id: ctx.branchId } }, select: { name: true } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Menu</h1>
      <MenuTabs current="branch" />
      <p className="text-sm text-stone-600">
        You are changing the menu for <strong>{branch.name}</strong> only. Dishes, categories, kitchen stations and add-ons are set up once on the other tabs
        and apply to every branch; here this branch can charge its own price, stop offering a dish or a whole category, send a dish to a different kitchen
        station, and set its own price for add-on choices, without affecting the others. A blank price means the shared price. This applies to staff orders and
        to guests ordering from their phone at this branch&rsquo;s tables.
      </p>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {menu.categories.map((c) => (
        <section key={c.id} className={`card p-4 ${c.hiddenHere ? "opacity-70" : ""}`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              {c.name} {c.hiddenHere && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-normal">hidden at {branch.name}</span>}
            </h2>
            <form action={setCategoryHiddenAction.bind(null, c.id, !c.hiddenHere)}>
              <button className={btn}>{c.hiddenHere ? "Show this category here" : "Hide this category here"}</button>
            </form>
          </div>
          {c.items.length === 0 ? (
            <p className="text-sm text-stone-500">No dishes.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {c.items.map((i) => (
                <li key={i.id} className="py-2">
                  <form action={saveBranchItemAction.bind(null, i.id)} className="flex flex-wrap items-center gap-3">
                    <span className="min-w-40 flex-1">
                      <span className="font-medium">{i.name}</span>
                      <span className="ml-2 text-xs text-stone-500">
                        shared {formatNpr(i.basePrice)}
                        {i.sharedStation ? ` · ${i.sharedStation}` : ""}
                      </span>
                      {!i.sharedAvailable && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs">off everywhere</span>}
                    </span>
                    <label className="flex items-center gap-1 text-sm text-stone-600">
                      Rs
                      <input
                        name="price"
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={i.branchPrice === null ? "" : i.branchPrice / 100}
                        placeholder={String(i.basePrice / 100)}
                        aria-label={`Price of ${i.name} at ${branch.name}`}
                        className={`w-24 ${field}`}
                      />
                    </label>
                    <label className="flex items-center gap-1 text-sm text-stone-600">
                      Station
                      <select name="stationId" defaultValue={i.branchStationId ?? ""} aria-label={`Kitchen station for ${i.name} at ${branch.name}`} className={field}>
                        <option value="">Same as shared</option>
                        {menu.stations.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="available" defaultChecked={i.branchAvailable} /> Offered here
                    </label>
                    <button className={btn}>Save</button>
                    {(i.branchPrice !== null || !i.branchAvailable || i.branchStationId) && (
                      <span className="text-xs font-medium text-brand-700">{!i.branchAvailable ? "Not offered here" : "Different here"}</span>
                    )}
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {addOns.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-1 font-semibold">Add-on choices at {branch.name}</h2>
          <p className="mb-2 text-sm text-stone-500">Extra prices and which choices are offered here. A blank price means the shared price.</p>
          {addOns.map((g) => (
            <div key={g.id} className="mb-3">
              <h3 className="text-sm font-medium text-stone-600">{g.name}</h3>
              <ul className="divide-y divide-stone-100">
                {g.choices.map((a) => (
                  <li key={a.id} className="py-2">
                    <form action={saveBranchAddOnAction.bind(null, a.id)} className="flex flex-wrap items-center gap-3">
                      <span className="min-w-40 flex-1 text-sm font-medium">
                        {a.name} <span className="text-xs font-normal text-stone-500">shared +{formatNpr(a.basePrice)}</span>
                      </span>
                      <label className="flex items-center gap-1 text-sm text-stone-600">
                        +Rs
                        <input
                          name="price"
                          type="number"
                          min={0}
                          step="0.01"
                          defaultValue={a.branchPrice === null ? "" : a.branchPrice / 100}
                          placeholder={String(a.basePrice / 100)}
                          aria-label={`Extra price of ${a.name} at ${branch.name}`}
                          className={`w-24 ${field}`}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="available" defaultChecked={a.branchAvailable} /> Offered here
                      </label>
                      <button className={btn}>Save</button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
