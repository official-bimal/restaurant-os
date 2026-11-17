import { requireTenant } from "@/server/auth";
import { getMenuSetOverview } from "@/features/menu/server/menu-sets";
import { getMenuAdmin } from "@/features/menu/server/service";
import { DAY_NAMES, formatMinute } from "@/features/menu/menu-sets";
import { MenuTabs } from "@/components/menu-tabs";
import { activateAction, addScheduleAction, createSetAction, deleteSetAction, removeScheduleAction, setItemsAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "min-h-10 px-3 text-sm";
const smallBtn = "min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50";

export default async function MenuSetsPage({ searchParams }: PageProps<"/menu/sets">) {
  const ctx = await requireTenant("menu.manage");
  const { error } = await searchParams;
  const [overview, menu] = await Promise.all([getMenuSetOverview(ctx), getMenuAdmin(ctx)]);
  const dishes = menu.categories.flatMap((c) => c.items.map((i) => ({ id: i.id, name: i.name, category: c.name })));
  const { sets, schedules, manualId, showingAll, branchName } = overview;
  const manualName = sets.find((s) => s.id === manualId)?.name;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Menu</h1>
      <MenuTabs current="sets" />
      <p className="text-sm text-stone-600">
        A menu set is part of your menu, like Breakfast or Lunch. The sets and their dishes are shared by all branches, but which set is
        on and the weekly schedule belong to each branch: you are changing <strong>{branchName}</strong>. Only the dishes in the active set can be
        ordered, by staff and by guests. With no set active, the whole menu is open. Times use your business time zone.
      </p>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <section className="card space-y-3 p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Right now</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${showingAll ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}>
            {manualName ? `${manualName} (chosen by hand)` : showingAll ? "Whole menu" : "Following the schedule"}
          </span>
        </div>
        <form action={activateAction} className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium">
            Use
            <select name="setId" defaultValue={manualId ?? ""} className={`mt-1 block ${field}`}>
              <option value="">Follow the schedule (whole menu when none applies)</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} only
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary">Apply</button>
        </form>
      </section>

      <form action={createSetAction} className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm font-medium">
          New menu set
          <input name="name" required maxLength={60} placeholder="e.g. Breakfast" className={`mt-1 block ${field}`} />
        </label>
        <button className="btn-primary">Add set</button>
      </form>

      {sets.map((s) => (
        <section key={s.id} className="card space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">
              {s.name} <span className="text-sm font-normal text-stone-500">({s.items.length} dishes)</span>
            </h2>
            <form action={deleteSetAction.bind(null, s.id)}>
              <button className={`${smallBtn} text-red-700`}>Delete set</button>
            </form>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Choose dishes</summary>
            <form action={setItemsAction.bind(null, s.id)} className="mt-2 space-y-3">
              <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {dishes.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-stone-50">
                    <input type="checkbox" name="item" value={d.id} defaultChecked={s.items.some((i) => i.menuItemId === d.id)} />
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

      {sets.length > 0 && (
        <section className="card space-y-4 p-4">
          <h2 className="font-semibold">Weekly schedule</h2>
          {schedules.length === 0 ? (
            <p className="text-sm text-stone-500">No schedule yet.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {schedules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="w-28 font-medium">{DAY_NAMES[r.dayOfWeek]}</span>
                  <span className="text-stone-600">
                    {formatMinute(r.startMinute)} to {formatMinute(r.endMinute)}
                  </span>
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">{r.menuSet.name}</span>
                  <form action={removeScheduleAction.bind(null, r.id)} className="ml-auto">
                    <button className="text-xs text-red-700 underline">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addScheduleAction} className="space-y-3 rounded-xl bg-stone-50 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium">
                Set
                <select name="setId" className={`mt-1 block ${field}`}>
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                From
                <input name="start" type="time" required defaultValue="07:00" className={`mt-1 block ${field}`} />
              </label>
              <label className="text-sm font-medium">
                To
                <input name="end" type="time" required defaultValue="11:00" className={`mt-1 block ${field}`} />
              </label>
            </div>
            <fieldset>
              <legend className="text-sm font-medium">Days</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {DAY_NAMES.map((d, i) => (
                  <label key={d} className="flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm">
                    <input type="checkbox" name="day" value={i} /> {d.slice(0, 3)}
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="btn-primary">Add to schedule</button>
          </form>
        </section>
      )}
    </div>
  );
}
