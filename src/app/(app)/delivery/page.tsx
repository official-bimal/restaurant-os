import { requireTenant } from "@/server/auth";
import { formatNpr } from "@/features/billing/calc";
import { getDeliverySettings, listBands, listZones } from "@/features/delivery/server/service";
import { formatKm } from "@/features/orders/server/delivery";
import { db } from "@/server/db";
import {
  createBandAction,
  createZoneAction,
  setBandActiveAction,
  setRoadFactorAction,
  setVatOnFeeAction,
  setZoneActiveAction,
  updateBandAction,
  updateZoneAction,
} from "./actions";

export const dynamic = "force-dynamic";

const field = "min-h-10 px-3 text-sm";
const smallBtn = "min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50";

export default async function DeliveryPage({ searchParams }: PageProps<"/delivery">) {
  const ctx = await requireTenant("floor.manage");
  const { error } = await searchParams;
  const [zones, bands, settings, branch] = await Promise.all([
    listZones(ctx),
    listBands(ctx),
    getDeliverySettings(ctx),
    db.branch.findUniqueOrThrow({ where: { businessId_id: { businessId: ctx.businessId, id: ctx.branchId } }, select: { name: true } }),
  ]);
  const hasActive = zones.some((z) => z.active);
  const bandsOn = bands.some((b) => b.active);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Delivery zones</h1>
        <p className="text-sm text-stone-500">{branch.name}</p>
      </div>
      <p className="text-sm text-stone-600">
        Delivery can be priced two ways in each branch. <strong>By distance</strong>: add bands (up to 2 km costs Rs 100, up to 5 km costs
        Rs 200...) and the waiter enters the distance from a map app; beyond the last band is outside the range. <strong>By area</strong>: add zones
        with a flat fee. If a branch has bands they are used, else zones; with neither, delivery is free. The fee is added to the bill after
        tax with no service charge, and points are earned on the food only. Changing a fee only affects new orders.
      </p>

      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <form action={createZoneAction} className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm font-medium">
          New zone
          <input name="name" required maxLength={60} placeholder="e.g. Lakeside" className={`mt-1 block ${field}`} />
        </label>
        <label className="text-sm font-medium">
          Fee (Rs)
          <input name="fee" type="number" min={0} step="0.01" defaultValue={0} className={`mt-1 block w-28 ${field}`} />
        </label>
        <button className="btn-primary">Add zone</button>
      </form>

      <form action={setVatOnFeeAction} className="card flex flex-wrap items-center gap-3 p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="vat" defaultChecked={settings.vatOnDeliveryFee} /> Charge VAT on the delivery fee
        </label>
        <span className="text-xs text-stone-500">
          Applies to every branch.{" "}
          {settings.vatMode === "NONE"
            ? "Your business does not charge VAT, so this has no effect."
            : settings.vatMode === "INCLUSIVE"
              ? "Your prices include VAT, so the fee is treated as including it."
              : `VAT of ${settings.vatBps / 100}% is added on top of the fee.`}
        </span>
        <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50">Save</button>
      </form>

      <form action={setRoadFactorAction} className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm font-medium">
          Road distance as % of the straight line
          <input name="pct" type="number" min={100} max={300} step={1} defaultValue={settings.roadFactorPct} className={`mt-1 block w-28 ${field}`} />
        </label>
        <p className="max-w-md text-xs text-stone-500">
          When a waiter enters a customer location and the branch has a location (set on the Branches page), the distance is worked out
          automatically: the straight line stretched by this percentage (130 means 30% longer). If you run your own OSRM routing server, set
          <code> ROUTING_URL</code> and the real road distance is used instead (only coordinates are sent, nothing personal).
        </p>
        <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50">Save</button>
      </form>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Distance bands in this branch ({bands.length})</h2>
        <form action={createBandAction} className="flex flex-wrap items-end gap-3 rounded-xl bg-stone-50 p-3">
          <label className="text-sm font-medium">
            Up to (km)
            <input name="upToKm" type="number" min={0.1} step="0.1" required placeholder="2" className={`mt-1 block w-28 ${field}`} />
          </label>
          <label className="text-sm font-medium">
            Fee (Rs)
            <input name="fee" type="number" min={0} step="0.01" defaultValue={0} className={`mt-1 block w-28 ${field}`} />
          </label>
          <button className="btn-primary">Add band</button>
        </form>
        {bands.length > 0 && (
          <ul className="divide-y divide-stone-100">
            {bands.map((b) => (
              <li key={b.id} className="flex flex-wrap items-end gap-3 py-3">
                <form action={updateBandAction.bind(null, b.id)} className="flex flex-wrap items-end gap-2">
                  <label className="flex items-center gap-1 text-sm text-stone-500">
                    Up to
                    <input name="upToKm" type="number" min={0.1} step="0.1" defaultValue={b.upToMeters / 1000} aria-label="Up to kilometres" className={`w-24 ${field}`} /> km
                  </label>
                  <label className="flex items-center gap-1 text-sm text-stone-500">
                    Rs
                    <input name="fee" type="number" min={0} step="0.01" defaultValue={b.fee / 100} aria-label={`Fee up to ${formatKm(b.upToMeters)}`} className={`w-24 ${field}`} />
                  </label>
                  <button className={smallBtn}>Save</button>
                </form>
                <span className="text-sm text-stone-500">
                  {formatKm(b.upToMeters)} · {formatNpr(b.fee)}
                </span>
                {!b.active && <span className="rounded-full bg-stone-100 px-3 py-1 text-xs">Switched off</span>}
                <form action={setBandActiveAction.bind(null, b.id, !b.active)}>
                  <button className={smallBtn}>{b.active ? "Switch off" : "Switch on"}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {bandsOn && <p className="text-sm text-amber-800">Distance bands are on, so zones below are not used in this branch.</p>}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Zones in this branch ({zones.length})</h2>
        {zones.length === 0 ? (
          <p className="text-sm text-stone-500">No zones yet, so delivery is free here.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {zones.map((z) => (
              <li key={z.id} className="flex flex-wrap items-end gap-3 py-3">
                <form action={updateZoneAction.bind(null, z.id)} className="flex flex-wrap items-end gap-2">
                  <input name="name" defaultValue={z.name} required maxLength={60} aria-label="Zone name" className={field} />
                  <label className="flex items-center gap-1 text-sm text-stone-500">
                    Rs
                    <input name="fee" type="number" min={0} step="0.01" defaultValue={z.fee / 100} aria-label={`Fee for ${z.name}`} className={`w-24 ${field}`} />
                  </label>
                  <button className={smallBtn}>Save</button>
                </form>
                <span className="text-sm text-stone-500">{formatNpr(z.fee)}</span>
                {!z.active && <span className="rounded-full bg-stone-100 px-3 py-1 text-xs">Switched off</span>}
                <form action={setZoneActiveAction.bind(null, z.id, !z.active)}>
                  <button className={smallBtn}>{z.active ? "Switch off" : "Switch on"}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {zones.length > 0 && !hasActive && <p className="mt-2 text-sm text-amber-800">All zones are switched off, so delivery is free right now.</p>}
      </section>
    </div>
  );
}
