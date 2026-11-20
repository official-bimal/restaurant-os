import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { db } from "@/server/db";
import { hasAgentKey } from "@/features/printing/server/settings";
import { getRoutes, listPrinters } from "@/features/printing/server/printers";
import { seenText, NO_STATION } from "@/features/printing/routing";
import { AutoRefresh } from "@/components/auto-refresh";
import { PrintingTabs } from "../printing-tabs";
import { addPrinterAction, deletePrinterAction, saveRoutesAction, testAllAction, testPrinterAction, updatePrinterAction } from "../printer-actions";

export const dynamic = "force-dynamic";

const input = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

export default async function PrintersPage({ searchParams }: PageProps<"/printing/printers">) {
  const ctx = await requireTenant("print.manage");
  const q = await searchParams;
  const [printers, { routes, stations }, hasKey, branch] = await Promise.all([
    listPrinters(ctx),
    getRoutes(ctx),
    hasAgentKey(ctx.businessId),
    db.branch.findUniqueOrThrow({ where: { businessId_id: { businessId: ctx.businessId, id: ctx.branchId } }, select: { name: true } }),
  ]);
  const now = new Date();
  const route = (kind: string, key = NO_STATION) => routes.find((r) => r.kind === kind && r.stationKey === key)?.printerId ?? "";
  const options = (empty: string) => (
    <>
      <option value="">{empty}</option>
      {printers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </>
  );
  const nameOf = (id: string) => printers.find((p) => p.id === id)?.name;

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={15000} />
      <div>
        <h1 className="text-2xl font-semibold">Printing</h1>
        <p className="text-sm text-stone-500">Printers at {branch.name}, and which one prints what.</p>
      </div>
      <PrintingTabs current="/printing/printers" />

      {typeof q.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {q.error}
        </p>
      )}
      {typeof q.note === "string" && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          {q.note}
        </p>
      )}

      <section className="card space-y-4 p-5" aria-labelledby="printers">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="printers" className="mr-auto font-semibold">
            Printers
          </h2>
          {printers.length > 0 && (
            <form action={testAllAction}>
              <button className="btn-secondary">Test all printers</button>
            </form>
          )}
        </div>
        {!hasKey && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            No printer key yet. The small program next to a printer needs one to collect its slips. <Link href="/printing" className="font-medium underline">Make a key on the Paper and queue tab.</Link>
          </p>
        )}
        {printers.length === 0 ? (
          <p className="rounded-lg bg-stone-50 p-4 text-sm text-stone-600">No printers added for this branch yet. Add the kitchen printer, the bar printer, the counter printer: whatever you have.</p>
        ) : (
          <ul className="space-y-3">
            {printers.map((p) => {
              const seen = seenText(p.lastSeenAt, now);
              return (
                <li key={p.id} className="rounded-xl border border-stone-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold">{p.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${seen.online ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900"}`}>{seen.text}</span>
                    {p.waiting > 0 && <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700">{p.waiting} waiting</span>}
                    <span className="text-xs text-stone-500">{p.paperWidthMm ? `${p.paperWidthMm} mm paper` : "paper size from the business setting"}</span>
                    <form action={testPrinterAction.bind(null, p.id)} className="ml-auto">
                      <button className="btn-secondary !min-h-9">Test print</button>
                    </form>
                  </div>
                  <p className="mt-2 text-xs text-stone-500">
                    Its id, for the program next to it: <code className="select-all break-all rounded bg-stone-100 px-1.5 py-0.5 font-mono text-stone-800">PRINTER_ID={p.id}</code>
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium text-brand-700">Change name or paper, or remove</summary>
                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      <form action={updatePrinterAction.bind(null, p.id)} className="flex flex-wrap items-end gap-3">
                        <label className="text-sm">
                          Name
                          <input name="name" defaultValue={p.name} required maxLength={40} className={input} />
                        </label>
                        <label className="text-sm">
                          Paper width (mm)
                          <input name="paperWidthMm" type="number" min={40} max={300} defaultValue={p.paperWidthMm ?? ""} placeholder="business setting" className={`${input} w-40`} />
                        </label>
                        <button className="btn-primary">Save</button>
                      </form>
                      <form action={deletePrinterAction.bind(null, p.id)}>
                        <button className="min-h-10 rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 hover:bg-red-50">Remove printer</button>
                      </form>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}

        <form action={addPrinterAction} className="flex flex-wrap items-end gap-3 border-t border-stone-100 pt-4">
          <label className="text-sm">
            New printer
            <input name="name" required maxLength={40} placeholder="Kitchen, Bar, Counter" className={`${input} w-56`} />
          </label>
          <label className="text-sm">
            Paper width (mm)
            <input name="paperWidthMm" type="number" min={40} max={300} placeholder="business setting" className={`${input} w-40`} />
          </label>
          <button className="btn-primary">Add printer</button>
        </form>
      </section>

      <section className="card space-y-4 p-5" aria-labelledby="routing">
        <div>
          <h2 id="routing" className="font-semibold">
            Where each slip prints
          </h2>
          <p className="text-sm text-stone-600">
            Choose the printer for each kind of slip. Kitchen slips can also go by station: the Bar dishes to the bar printer, the Grill dishes to the kitchen printer, each with only its own items. A printer left on &ldquo;no printer chosen&rdquo; uses a program that does not name a
            printer, as before.
          </p>
        </div>
        {printers.length === 0 ? (
          <p className="text-sm text-stone-500">Add a printer first.</p>
        ) : (
          <form action={saveRoutesAction} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-medium">
                Kitchen slips
                <select name="route.KITCHEN" defaultValue={route("KITCHEN")} className={input}>
                  {options("No printer chosen")}
                </select>
              </label>
              <label className="text-sm font-medium">
                Bills
                <select name="route.RECEIPT" defaultValue={route("RECEIPT")} className={input}>
                  {options("No printer chosen")}
                </select>
              </label>
              <label className="text-sm font-medium">
                Credit notes
                <select name="route.CREDIT_NOTE" defaultValue={route("CREDIT_NOTE")} className={input}>
                  {options("No printer chosen")}
                </select>
              </label>
            </div>
            {stations.length > 0 && (
              <fieldset className="rounded-xl border border-stone-200 p-4">
                <legend className="px-1 text-sm font-semibold">Kitchen slips by station</legend>
                <p className="mb-3 text-xs text-stone-500">A station left on &ldquo;same as kitchen slips&rdquo; prints on the kitchen printer chosen above. Dishes with no station always use that one.</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {stations.map((s) => (
                    <label key={s.id} className="text-sm font-medium">
                      {s.name}
                      <select name={`station.${s.id}`} defaultValue={route("KITCHEN", s.id)} className={input}>
                        {options("Same as kitchen slips")}
                      </select>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <button className="btn-primary">Save routing</button>
          </form>
        )}
        {routes.length > 0 && (
          <ul className="space-y-0.5 rounded-xl bg-stone-50 p-3 text-sm text-stone-700">
            {routes.map((r) => (
              <li key={`${r.kind}${r.stationKey}`}>
                {r.kind === "KITCHEN" ? (r.stationKey ? `${stations.find((s) => s.id === r.stationKey)?.name ?? "A station"} items` : "Kitchen slips") : r.kind === "RECEIPT" ? "Bills" : "Credit notes"} → <strong>{nameOf(r.printerId) ?? "?"}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5 text-sm text-stone-600">
        <h2 className="mb-1 font-semibold text-stone-900">Connecting a printer</h2>
        <p>
          Run the program from <code>scripts/print-agent.mjs</code> next to each printer, with that printer&apos;s id: <code>PRINTER_ID=… PRINT_KEY=… APP_URL=… PRINTER_HOST=… node scripts/print-agent.mjs</code>. When it checks in, the printer shows as connected above. Press Test print to prove the whole path
          before the first order.
        </p>
      </section>
    </div>
  );
}
