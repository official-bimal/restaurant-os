import { requireTenant } from "@/server/auth";
import { listBranches } from "@/features/branches/server/service";
import { createBranchAction, setBranchActiveAction, setBranchLocationAction, updateBranchAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "min-h-10 rounded-lg border border-stone-300 px-3 text-sm";
const smallBtn = "min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50";

export default async function BranchesPage({ searchParams }: PageProps<"/branches">) {
  const ctx = await requireTenant("branch.manage");
  const { error } = await searchParams;
  const branches = await listBranches(ctx);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Branches</h1>
      <p className="text-sm text-stone-600">
        Tables, orders, bills and the daily cash count belong to a branch. Stock levels, reorder levels, purchase orders and stock history are
        kept per branch. The menu, recipes, customers, loyalty points and suppliers are shared by the whole business.
      </p>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <form action={createBranchAction} className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <label className="text-sm">
          <span className="block text-stone-600">New branch name</span>
          <input name="name" required maxLength={60} className={field} />
        </label>
        <label className="text-sm">
          <span className="block text-stone-600">Address (optional)</span>
          <input name="address" maxLength={200} className={field} />
        </label>
        <button className="min-h-10 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 text-sm text-white">Add branch</button>
      </form>

      <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <h2 className="mb-2 font-semibold">All branches ({branches.length})</h2>
        <ul className="divide-y divide-stone-100">
          {branches.map((b) => (
            <li key={b.id} className="flex flex-wrap items-end gap-3 py-3">
              <form action={updateBranchAction.bind(null, b.id)} className="flex flex-wrap items-end gap-2">
                <label className="text-sm">
                  <span className="block text-xs text-stone-500">Name</span>
                  <input name="name" defaultValue={b.name} required maxLength={60} className={field} />
                </label>
                <label className="text-sm">
                  <span className="block text-xs text-stone-500">Address</span>
                  <input name="address" defaultValue={b.address ?? ""} maxLength={200} className={field} />
                </label>
                <button className={smallBtn}>Save</button>
              </form>
              <form action={setBranchLocationAction.bind(null, b.id)} className="flex flex-wrap items-end gap-2">
                <label className="text-sm">
                  <span className="block text-xs text-stone-500">Location (coordinates or map link)</span>
                  <input
                    name="location"
                    defaultValue={b.latitude != null && b.longitude != null ? `${b.latitude}, ${b.longitude}` : ""}
                    placeholder="27.7172, 85.324"
                    className={`w-56 ${field}`}
                  />
                </label>
                <button className={smallBtn}>Save location</button>
              </form>
              <span className="text-sm text-stone-500">{b._count.tables} tables</span>
              {!b.active && <span className="rounded-full bg-stone-100 px-3 py-1 text-xs">Switched off</span>}
              <form action={setBranchActiveAction.bind(null, b.id, !b.active)}>
                <button className={smallBtn}>{b.active ? "Switch off" : "Switch on"}</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
