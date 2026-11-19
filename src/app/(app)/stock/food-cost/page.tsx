import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { formatNpr } from "@/features/billing/calc";
import { suggestedPrice, type DishClass } from "@/features/stock/foodcost";
import { getFoodCostReport } from "@/features/stock/server/foodcost";
import { isValidDate } from "@/lib/business-day";

export const dynamic = "force-dynamic";

const CLASS: Record<DishClass, { label: string; tone: string; hint: string }> = {
  STAR: { label: "Star", tone: "bg-emerald-100 text-emerald-900", hint: "Sells well and earns well. Keep it, protect its quality." },
  PLOWHORSE: { label: "Plowhorse", tone: "bg-amber-100 text-amber-900", hint: "Sells well but earns little per plate. Try a small price rise or a cheaper recipe." },
  PUZZLE: { label: "Puzzle", tone: "bg-sky-100 text-sky-900", hint: "Earns well but few order it. Put it forward on the menu or in the staff's pitch." },
  DOG: { label: "Dog", tone: "bg-rose-100 text-rose-900", hint: "Sells little and earns little. Think about dropping or changing it." },
  NO_RECIPE: { label: "No recipe", tone: "bg-stone-200 text-stone-700", hint: "Write its recipe to see its cost." },
};

const input = "mt-1 block min-h-10 rounded-lg border border-stone-300 px-3 text-sm";

export default async function FoodCostPage({ searchParams }: PageProps<"/stock/food-cost">) {
  const ctx = await requireTenant("stock.manage");
  const sp = await searchParams;
  const from = typeof sp.from === "string" && isValidDate(sp.from) ? sp.from : undefined;
  const to = typeof sp.to === "string" && isValidDate(sp.to) ? sp.to : undefined;
  const targetRaw = Number(typeof sp.target === "string" ? sp.target : "30");
  const target = targetRaw > 0 && targetRaw < 100 ? targetRaw : 30;
  const r = await getFoodCostReport(ctx, { from, to });
  const t = r.totals;
  const pct = (v: number | null) => (v === null ? "-" : `${v}%`);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/stock/recipes" className="text-sm text-stone-500 hover:underline">
          ← Recipes
        </Link>
        <h1 className="text-xl font-semibold">Food cost</h1>
      </div>
      <form className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          From
          <input type="date" name="from" defaultValue={r.from} className={input} />
        </label>
        <label className="text-sm">
          To
          <input type="date" name="to" defaultValue={r.to} className={input} />
        </label>
        <label className="text-sm">
          Target food cost (%)
          <input name="target" inputMode="decimal" defaultValue={String(target)} className={`${input} w-24`} />
        </label>
        <button className="min-h-10 rounded-lg bg-teal-700 px-4 text-sm font-medium text-white">Show</button>
      </form>
      <p className="text-sm text-stone-600">
        This branch only, before VAT and service charge. Ingredient cost comes from each dish&apos;s recipe at today&apos;s average ingredient cost. A restaurant usually aims for about 25% to 35%.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-sm text-stone-600">Food sales (after discounts)</p>
          <p className="text-xl font-semibold">{formatNpr(t.netSales)}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-stone-600">Ingredients used by sales</p>
          <p className="text-xl font-semibold">{formatNpr(t.usedBySales)}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-stone-600">Food cost</p>
          <p className={`text-xl font-semibold ${t.foodCostPercent !== null && t.foodCostPercent > target ? "text-red-700" : "text-emerald-700"}`}>{pct(t.foodCostPercent)}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-stone-600">With waste and missing stock</p>
          <p className="text-xl font-semibold">{pct(t.trueCostPercent)}</p>
          <p className="text-xs text-stone-500">
            waste {formatNpr(t.waste)}, counts {formatNpr(t.countLoss)}
          </p>
        </div>
      </div>
      {t.noRecipeShare > 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {t.noRecipeShare}% of sales are dishes with no recipe, so the food cost above is lower than the truth. Write their recipes under Recipes.
        </p>
      )}

      <section className="card overflow-x-auto p-4">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="py-1">Dish</th>
              <th className="py-1 text-right">Sold</th>
              <th className="py-1 text-right">Price each</th>
              <th className="py-1 text-right">Cost each</th>
              <th className="py-1 text-right">Cost %</th>
              <th className="py-1 text-right">Profit</th>
              <th className="py-1 text-right">Price for {target}%</th>
              <th className="py-1">Kind</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-2 text-stone-600">
                  Nothing was sold in this period.
                </td>
              </tr>
            )}
            {r.rows.map((d) => {
              const k = CLASS[d.klass];
              const price = d.quantity > 0 ? Math.round(d.revenue / d.quantity) : 0;
              return (
                <tr key={d.menuItemId} className="border-t border-stone-100">
                  <td className="py-1">{d.name}</td>
                  <td className="py-1 text-right">{d.quantity}</td>
                  <td className="py-1 text-right">{formatNpr(price)}</td>
                  <td className="py-1 text-right">{d.unitCost === null ? "-" : formatNpr(d.unitCost)}</td>
                  <td className={`py-1 text-right ${d.costPercent !== null && d.costPercent > target ? "text-red-700" : ""}`}>{pct(d.costPercent)}</td>
                  <td className="py-1 text-right">{d.profit === null ? "-" : formatNpr(d.profit)}</td>
                  <td className="py-1 text-right">{d.unitCost ? formatNpr(suggestedPrice(d.unitCost, target)) : "-"}</td>
                  <td className="py-1">
                    <span title={k.hint} className={`rounded px-2 py-0.5 text-xs ${k.tone}`}>
                      {k.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-stone-500">
          Star: sells well and earns well. Plowhorse: sells well, earns little per plate. Puzzle: earns well, few order it. Dog: neither. Hover a kind for what to do. &quot;Price for {target}%&quot; is the
          price that would reach your target, rounded up to the next Rs 5, before VAT.
        </p>
      </section>
    </div>
  );
}
