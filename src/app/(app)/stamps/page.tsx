import { requireTenant } from "@/server/auth";
import { db } from "@/server/db";
import { listStampPrograms } from "@/features/loyalty/server/stamps";
import { deleteStampProgramAction, saveStampProgramAction, toggleStampProgramAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

export default async function StampsPage({ searchParams }: PageProps<"/stamps">) {
  const ctx = await requireTenant("campaign.manage");
  const sp = await searchParams;
  const [programs, categories, items] = await Promise.all([
    listStampPrograms(ctx),
    db.menuCategory.findMany({ where: { businessId: ctx.businessId }, orderBy: { sortOrder: "asc" } }),
    db.menuItem.findMany({ where: { businessId: ctx.businessId, available: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Stamp cards</h1>
      <p className="text-sm text-stone-600">
        &ldquo;Every 10th coffee free.&rdquo; Each qualifying dish a customer buys is one stamp, counted from their paid bills; when the card is full they get one free dish from it. At the till, attach the customer to the
        order and confirm in person who they are; their cards show on the bill with a choice of which dish is free. A bill that is refunded in full earns no stamps, and gives back a free dish it used.
        Stamps are only counted for customers attached to the order.
      </p>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}
      <form action={saveStampProgramAction} className="card space-y-3 p-4">
        <h2 className="font-semibold">New card</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Name
            <input name="name" required maxLength={60} className={field} placeholder="Coffee card" />
          </label>
          <label className="text-sm">
            Stamps for one free dish
            <input name="target" type="number" min={2} max={50} defaultValue={10} required className={field} />
          </label>
        </div>
        <fieldset className="text-sm">
          <legend className="font-medium">Which dishes earn stamps (and can be the free one)</legend>
          <p className="text-xs text-stone-500">Choose categories or dishes. Leave all empty and every dish counts.</p>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <select key={i} name={`item${i}`} defaultValue="" aria-label={`Covered category or dish ${i + 1}`} className="block rounded-lg border border-stone-300 px-2 py-2">
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
            ))}
          </div>
        </fieldset>
        <button className="min-h-11 rounded-lg bg-brand-600 px-5 font-medium text-white">Save card</button>
      </form>

      <section className="space-y-2">
        {programs.length === 0 && <p className="card p-4 text-stone-600">No stamp cards yet.</p>}
        {programs.map((p) => (
          <div key={p.id} className={`card flex flex-wrap items-start gap-3 p-4 ${p.active ? "" : "opacity-60"}`}>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {p.name} <span className="text-sm font-normal text-stone-600">every {p.target}th is free</span>
              </p>
              <p className="text-sm text-stone-600">
                {p.items.length === 0 ? "Every dish counts." : p.items.map((i) => (i.categoryId ? (catName.get(i.categoryId) ?? "category") : (itemName.get(i.menuItemId ?? "") ?? "dish"))).join(", ")}
              </p>
              <p className="text-xs text-stone-500">
                {p._count.redemptions} free dish{p._count.redemptions === 1 ? "" : "es"} given so far
              </p>
            </div>
            <form action={toggleStampProgramAction.bind(null, p.id, !p.active)}>
              <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm">{p.active ? "Switch off" : "Switch on"}</button>
            </form>
            {p._count.redemptions === 0 && (
              <form action={deleteStampProgramAction.bind(null, p.id)}>
                <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm text-red-700">Delete</button>
              </form>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
