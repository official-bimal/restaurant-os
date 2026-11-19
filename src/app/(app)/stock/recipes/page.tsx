import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { getRecipes, listStock } from "@/features/stock/server/service";
import { margin, recipeCost } from "@/features/stock/stock";
import { formatNpr } from "@/features/billing/calc";
import { setRecipeAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function RecipesPage({ searchParams }: PageProps<"/stock/recipes">) {
  const ctx = await requireTenant("stock.manage");
  const { error } = await searchParams;
  const [dishes, items] = await Promise.all([getRecipes(ctx), listStock(ctx)]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/stock" className="text-sm text-stone-500 hover:underline">
          ← Stock
        </Link>
        <h1 className="text-xl font-semibold">Recipes and food cost</h1>
      </div>
      <p className="text-sm text-stone-600">
        Say how much of each ingredient one portion uses. When a bill is paid, those amounts come off stock, and the cost
        shows here as food cost and margin. Dishes without a recipe use no stock.{" "}
        <Link href="/stock/food-cost" className="text-teal-700 underline">
          See food cost % and which dishes earn most
        </Link>
        .
      </p>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {items.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Add stock items first, then write recipes.</p>}

      <ul className="space-y-3">
        {dishes.map((d) => {
          const cost = recipeCost(d.recipe.map((r) => ({ quantity: r.quantity, costMilli: r.stockItem.costMilli })));
          const m = margin(d.price, cost);
          const used = new Map(d.recipe.map((r) => [r.stockItemId, r.quantity]));
          return (
            <li key={d.id} className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="font-semibold">{d.name}</h2>
                <span className="text-sm text-stone-500">{d.category.name}</span>
                <span className="text-sm">Price {formatNpr(d.price)}</span>
                {d.recipe.length > 0 ? (
                  <span className="text-sm">
                    Food cost {formatNpr(cost)} · margin {formatNpr(m.amount)}
                    {m.percent !== null ? ` (${m.percent}%)` : ""}
                  </span>
                ) : (
                  <span className="text-sm text-stone-400">No recipe</span>
                )}
              </div>
              {d.recipe.length > 0 && (
                <p className="mt-1 text-sm text-stone-600">
                  {d.recipe.map((r) => `${r.quantity} ${r.stockItem.unit} ${r.stockItem.name}`).join(" · ")}
                </p>
              )}
              {items.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium">{d.recipe.length > 0 ? "Edit recipe" : "Write recipe"}</summary>
                  <form action={setRecipeAction.bind(null, d.id)} className="mt-2 space-y-2 text-sm">
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {items.map((i) => (
                        <li key={i.id} className="flex items-center justify-between gap-2">
                          <label htmlFor={`stock_${d.id}_${i.id}`} className="min-w-0 flex-1 truncate">
                            {i.name} <span className="text-stone-500">({i.unit})</span>
                          </label>
                          <input
                            id={`stock_${d.id}_${i.id}`}
                            name={`stock_${i.id}`}
                            type="number"
                            min={0}
                            defaultValue={used.get(i.id) ?? 0}
                            className="w-24 rounded-lg border border-stone-300 px-2 py-1.5 text-right"
                          />
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-stone-500">Amount used by one portion. Leave 0 for ingredients this dish does not use.</p>
                    <button className="min-h-9 rounded-lg bg-brand-600 hover:bg-brand-700 px-3 text-white">Save recipe</button>
                  </form>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
