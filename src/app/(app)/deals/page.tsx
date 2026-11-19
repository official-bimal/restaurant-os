import { requireTenant } from "@/server/auth";
import { db } from "@/server/db";
import { formatNpr } from "@/features/billing/calc";
import { listDeals } from "@/features/billing/server/deals";
import { deleteDealAction, saveDealAction, toggleDealAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clock(m: number | null) {
  return m === null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export default async function DealsPage({ searchParams }: PageProps<"/deals">) {
  const ctx = await requireTenant("menu.manage");
  const sp = await searchParams;
  const [deals, categories, items, branches] = await Promise.all([
    listDeals(ctx),
    db.menuCategory.findMany({ where: { businessId: ctx.businessId }, orderBy: { sortOrder: "asc" } }),
    db.menuItem.findMany({ where: { businessId: ctx.businessId, available: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.branch.findMany({ where: { businessId: ctx.businessId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Deals</h1>
      <p className="text-sm text-stone-600">
        Happy hour (a percentage off chosen dishes at certain times) and combos (a set price for a bundle, like a coffee and a snack). A deal is applied by itself at the till when a bill
        qualifies. If more than one qualifies, the one that saves the guest most is used; deals never add up. A discount the cashier types is taken off after the deal.
      </p>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}

      <form action={saveDealAction} className="card space-y-3 p-4">
        <h2 className="font-semibold">New deal</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Name
            <input name="name" required maxLength={60} className={field} placeholder="Happy hour" />
          </label>
          <label className="text-sm">
            Kind
            <select name="kind" className={field} defaultValue="PERCENT_OFF">
              <option value="PERCENT_OFF">Percentage off (happy hour)</option>
              <option value="COMBO">Combo (set price for a bundle)</option>
            </select>
          </label>
          <label className="text-sm">
            Branch
            <select name="branchId" className={field} defaultValue="">
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Percentage off (happy hour)
            <input name="percent" inputMode="decimal" className={field} placeholder="20" />
          </label>
          <label className="text-sm">
            Price of one bundle, Rs (combo)
            <input name="comboPrice" inputMode="decimal" className={field} placeholder="300" />
          </label>
        </div>
        <fieldset className="text-sm">
          <legend className="font-medium">Days (none ticked: every day)</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1">
                <input type="checkbox" name="day" value={i} className="h-5 w-5" /> {d}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            From (empty: all day)
            <input type="time" name="start" className={field} />
          </label>
          <label className="text-sm">
            Until
            <input type="time" name="end" className={field} />
          </label>
        </div>
        <fieldset className="text-sm">
          <legend className="font-medium">What it covers</legend>
          <p className="text-xs text-stone-500">
            Happy hour: the categories or dishes it applies to (leave all empty for everything). Combo: what one bundle needs, for example 1 from Hot Coffee and 1 from Food Item.
          </p>
          <div className="mt-1 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-2">
                <select name={`item${i}`} defaultValue="" aria-label={`Covered category or dish ${i + 1}`} className="block min-w-0 flex-1 rounded-lg border border-stone-300 px-2 py-2">
                  <option value="">—</option>
                  <optgroup label="Categories">
                    {categories.map((c) => (
                      <option key={c.id} value={`c:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Dishes">
                    {items.map((m) => (
                      <option key={m.id} value={`m:${m.id}`}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <input name={`qty${i}`} type="number" min={1} max={20} defaultValue={1} aria-label={`How many in a bundle ${i + 1}`} className="w-20 rounded-lg border border-stone-300 px-2 py-2" />
              </div>
            ))}
          </div>
        </fieldset>
        <button className="min-h-11 rounded-lg bg-brand-600 px-5 font-medium text-white">Save deal</button>
      </form>

      <section className="space-y-2">
        {deals.length === 0 && <p className="card p-4 text-stone-600">No deals yet.</p>}
        {deals.map((d) => (
          <div key={d.id} className={`card flex flex-wrap items-start gap-3 p-4 ${d.active ? "" : "opacity-60"}`}>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {d.name} <span className="text-sm font-normal text-stone-600">{d.kind === "PERCENT_OFF" ? `${d.percentBps / 100}% off` : `bundle for ${formatNpr(d.comboPrice)}`}</span>
              </p>
              <p className="text-sm text-stone-600">
                {d.days ? d.days.split(",").map((x) => DAYS[Number(x)]).join(", ") : "Every day"}
                {d.startMinute !== null && d.endMinute !== null ? `, ${clock(d.startMinute)} to ${clock(d.endMinute)}` : ", all day"}
                {d.branchId ? ` · ${branches.find((b) => b.id === d.branchId)?.name ?? "one branch"}` : " · all branches"}
              </p>
              <p className="text-sm text-stone-600">
                {d.items.length === 0
                  ? "Covers everything."
                  : d.items.map((i) => `${d.kind === "COMBO" ? `${i.quantity} × ` : ""}${i.categoryId ? (catName.get(i.categoryId) ?? "category") : (itemName.get(i.menuItemId ?? "") ?? "dish")}`).join(" + ")}
              </p>
            </div>
            <form action={toggleDealAction.bind(null, d.id, !d.active)}>
              <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm">{d.active ? "Switch off" : "Switch on"}</button>
            </form>
            <form action={deleteDealAction.bind(null, d.id)}>
              <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm text-red-700">Delete</button>
            </form>
          </div>
        ))}
      </section>
    </div>
  );
}
