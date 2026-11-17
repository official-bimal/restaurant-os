import { requireTenant } from "@/server/auth";
import Link from "next/link";
import { getFloorAdmin, getGuestSettings } from "@/features/floor/server/service";
import {
  createAreaAction,
  createTableAction,
  deleteAreaAction,
  deleteTableAction,
  renameAreaAction,
  resetQrAction,
  setGuestSettingsAction,
  updateTableAction,
} from "./actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";
const smallBtn = "min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50";

const STATE_STYLE: Record<string, string> = {
  FREE: "bg-green-100 text-green-800",
  SEATED: "bg-amber-100 text-amber-800",
  BILL_REQUESTED: "bg-blue-100 text-blue-800",
};

export default async function TablesPage({ searchParams }: PageProps<"/tables">) {
  const ctx = await requireTenant("floor.manage");
  const { error } = await searchParams;
  const [areas, guest] = await Promise.all([getFloorAdmin(ctx), getGuestSettings(ctx)]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Tables and areas</h1>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <form action={setGuestSettingsAction} className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Guest ordering by QR code</h2>
          <Link href="/tables/qr" className={smallBtn + " flex items-center"}>
            Print QR codes
          </Link>
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={guest.guestOrderingEnabled} className="mt-1 h-4 w-4" />
          <span>
            <strong>Let guests order from their phone.</strong> Switch off to stop all guest orders at once.
          </span>
        </label>
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input type="checkbox" name="requireApproval" defaultChecked={guest.requireOrderApproval} className="mt-1 h-4 w-4" />
          <span>
            <strong>Staff must accept each guest order first.</strong> Recommended: it stops anyone ordering from a
            photo of the QR code. If off, guest orders go straight to the kitchen.
          </span>
        </label>
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input type="checkbox" name="bestSellers" defaultChecked={guest.guestBestSellers} className="mt-1 h-4 w-4" />
          <span>
            <strong>Show &quot;Best selling&quot; on the guest menu.</strong> Puts the dishes sold most in the last 30 days at the top, with a
            badge. Guests see only the names, never how many were sold. Switch off to hide it.
          </span>
        </label>
        <button className="mt-3 min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Save</button>
      </form>

      <form action={createAreaAction} className="flex max-w-md items-end gap-2 rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
        <label className="flex-1 text-sm font-medium">
          New area
          <input name="name" required maxLength={40} placeholder="e.g. Rooftop" className={input} />
        </label>
        <button className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Add area</button>
      </form>

      {areas.length === 0 && <p className="text-stone-500">Add an area first, then add tables to it.</p>}

      {areas.map((area) => (
        <section key={area.id} className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-lg font-semibold">
              {area.name} <span className="text-sm font-normal text-stone-500">({area.tables.length})</span>
            </h2>
            <details className="relative">
              <summary className={`${smallBtn} flex cursor-pointer items-center`}>Rename</summary>
              <form
                action={renameAreaAction.bind(null, area.id)}
                className="absolute right-0 z-10 mt-1 flex w-64 gap-2 rounded-lg bg-white p-3 shadow border border-stone-200 shadow-sm"
              >
                <input name="name" required maxLength={40} defaultValue={area.name} aria-label="Area name" className={input} />
                <button className={smallBtn}>Save</button>
              </form>
            </details>
            <form action={deleteAreaAction.bind(null, area.id)}>
              <button
                className={`${smallBtn} text-red-700 disabled:text-stone-400`}
                disabled={area.tables.length > 0}
                title={area.tables.length > 0 ? "Remove its tables first" : undefined}
              >
                Delete
              </button>
            </form>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {area.tables.map((t) => (
              <li key={t.id} className="rounded-lg border border-stone-200 p-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{t.label}</span>
                  <span className="text-sm text-stone-500">{t.capacity} seats</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${STATE_STYLE[t.state]}`}>
                    {t.state.replace("_", " ").toLowerCase()}
                  </span>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-stone-600">Edit</summary>
                  <form action={updateTableAction.bind(null, t.id)} className="mt-2 space-y-2">
                    <label className="block text-sm font-medium">
                      Label
                      <input name="label" required maxLength={20} defaultValue={t.label} className={input} />
                    </label>
                    <label className="block text-sm font-medium">
                      Seats
                      <input name="capacity" type="number" min={1} max={50} defaultValue={t.capacity} className={input} />
                    </label>
                    <label className="block text-sm font-medium">
                      Area
                      <select name="areaId" defaultValue={area.id} className={input}>
                        {areas.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className={smallBtn}>Save</button>
                  </form>
                </details>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-stone-600">Reset QR code</summary>
                  <form action={resetQrAction.bind(null, t.id)} className="mt-2 rounded-lg bg-amber-50 p-3 text-sm">
                    <p>The printed code stops working and any guest session at this table ends. Print the new code afterwards.</p>
                    <button className="mt-2 min-h-9 rounded-lg border border-amber-400 bg-white px-3">Reset QR</button>
                  </form>
                </details>
                <form action={deleteTableAction.bind(null, t.id)} className="mt-2">
                  <button
                    className={`${smallBtn} text-red-700 disabled:text-stone-400`}
                    disabled={t._count.orders > 0 || t._count.sessions > 0 || t.state !== "FREE"}
                    title={t._count.orders > 0 || t._count.sessions > 0 ? "Has history, cannot be deleted" : undefined}
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>

          <form action={createTableAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3">
            <input type="hidden" name="areaId" value={area.id} />
            <label className="text-sm font-medium">
              New table
              <input name="label" required maxLength={20} placeholder="e.g. T7" className="mt-1 block w-28 rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="text-sm font-medium">
              Seats
              <input name="capacity" type="number" min={1} max={50} defaultValue={4} className="mt-1 block w-20 rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <button className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white">Add table</button>
          </form>
        </section>
      ))}
    </div>
  );
}
