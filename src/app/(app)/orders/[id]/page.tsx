import { queuePrintAction } from "../../printing/actions";
import { PrintMenu } from "@/components/print-menu";
import { CustomerOsPoints } from "@/features/customeros/points";
import { listBillRewards, rewardUsedOnBill } from "@/features/customeros/server/reward";
import { getPrintConfig } from "@/features/printing/server/settings";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { getOrder, listMenu, previewBill } from "@/features/orders/server/service";
import { addOnsForMenu } from "@/features/menu/server/addons";
import { listRiders, locationView, mapPoints } from "@/features/delivery/server/service";
import { DeliveryMap } from "@/components/delivery-map";
import { AutoRefresh } from "@/components/auto-refresh";
import { DomainError } from "@/server/errors";
import { getOrderLoyalty } from "@/features/loyalty/server/customers";
import { maxRedeemBlocks } from "@/features/loyalty/points";
import { attachCustomerAction, confirmCustomerAction, detachCustomerAction } from "../customer-actions";
import { listRestructureOptions } from "@/features/orders/server/table-ops";
import { splitEvenly } from "@/features/billing/split";
import { mergeAction, moveTableAction, splitAction } from "../restructure-actions";
import { cancelOrderAction, refundInvoiceAction } from "../void-actions";
import { formatNpr, type DiscountInput } from "@/features/billing/calc";
import { nextItemStatuses } from "@/features/orders/status";
import {
  addItemAction,
  cancelItemAction,
  assignRiderAction,
  checkoutAction,
  deliveryStatusAction,
  itemStatusAction,
} from "../actions";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-stone-100 text-stone-700",
  PREPARING: "bg-amber-100 text-amber-800",
  READY: "bg-blue-100 text-blue-800",
  SERVED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-700 line-through",
};

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const ctx = await requireTenant();
  const { id } = await params;
  const query = await searchParams;
  const order = await getOrder(ctx, id);
  if (!order) notFound();

  const usedReward = order.invoice && can(ctx.role, "bill.refund") ? await rewardUsedOnBill(ctx.businessId, order.id) : null;
  const closed = order.status === "PAID" || order.status === "CANCELLED" || order.status === "MERGED";
  const discountPct = Math.min(100, Math.max(0, Number(query.discount ?? 0) || 0));
  const discount: DiscountInput =
    discountPct > 0 ? { kind: "percent", bps: Math.round(discountPct * 100) } : { kind: "none" };
  const hasActive = order.items.some((i) => i.status !== "CANCELLED");
  const canCustomer = can(ctx.role, "customer.use") && !closed;
  const loyalty = can(ctx.role, "customer.use") && !order.invoice ? await getOrderLoyalty(ctx, id) : null;

  // The bill without any reward first: it tells us how many reward blocks could be used.
  const base = !order.invoice && hasActive ? await previewBill(ctx, id, discount) : null;
  const maxBlocks =
    base && loyalty?.customer && loyalty.confirmed && loyalty.settings.enabled
      ? maxRedeemBlocks(loyalty.customer.pointsBalance, base.subtotal - base.discount, loyalty.settings)
      : 0;
  const redeemBlocks = Math.min(maxBlocks, Math.max(0, Math.floor(Number(query.redeem ?? 0)) || 0));
  // Rewards the customer has in Customer OS (only when it is connected and staff confirmed who the customer is).
  const billRewards = loyalty?.customer && loyalty.confirmed ? await listBillRewards(ctx, loyalty.customer.id) : { state: "off" as const, rewards: [] };
  const chosenReward = billRewards.rewards.find((r) => r.id === query.reward) ?? null;
  // A free-item reward needs one item on the bill to be the free one (the first live item unless the cashier picks another).
  const liveItems = order.items.filter((i) => i.status !== "CANCELLED" && !i.complimentary && i.unitPrice > 0);
  const freeItem = chosenReward?.type === "FREE_ITEM" ? (liveItems.find((i) => i.id === query.free) ?? liveItems[0] ?? null) : null;
  const rewardValue = chosenReward ? (chosenReward.type === "FREE_ITEM" ? (freeItem?.unitPrice ?? 0) : (chosenReward.valueMinor ?? 0)) : 0;
  let totals = base;
  let billError: string | null = null;
  if (base && (redeemBlocks > 0 || chosenReward) && loyalty) {
    try {
      totals = await previewBill(ctx, id, discount, redeemBlocks > 0 ? redeemBlocks * loyalty.settings.redeemPoints : 0, chosenReward ? { valueMinor: rewardValue } : null);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      billError = e.message;
    }
  }
  const [menu, addOns] = closed ? [[], new Map<string, Awaited<ReturnType<typeof addOnsForMenu>> extends Map<string, infer V> ? V : never>()] : await Promise.all([listMenu(ctx), addOnsForMenu(ctx)]);
  const riders = order.type === "DELIVERY" && order.deliveryStatus === "PREPARING" && can(ctx.role, "order.edit") ? await listRiders(ctx) : [];
  const riderLocation = locationView(order);
  const mp = mapPoints(order);
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const canRestructure = can(ctx.role, "order.restructure") && !closed;
  // Anyone who can edit may cancel an empty order; food on it needs the void permission.
  const hasFood = order.items.some((i) => i.status !== "CANCELLED");
  const canCancel = !closed && can(ctx.role, hasFood ? "order.void" : "order.edit");
  const printCfg = await getPrintConfig(ctx.businessId);
  const queueButton = (kind: string, id: string) => (
    <form action={queuePrintAction.bind(null, kind, id, order.id)}>
      <button className="min-h-9 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium hover:bg-stone-50">Send to printer queue</button>
    </form>
  );
  const refundedSoFar = order.invoice ? order.invoice.creditNotes.reduce((n, c) => n + c.grandTotal, 0) : 0;
  const refundLeft = order.invoice ? order.invoice.grandTotal - refundedSoFar : 0;
  const canRefund = can(ctx.role, "bill.refund") && !!order.invoice && refundLeft > 0;
  const options = canRestructure ? await listRestructureOptions(ctx, id) : null;
  const activeItems = order.items.filter((i) => i.status !== "CANCELLED");
  // A fresh key per page view: tapping "Split" twice cannot make two new bills.
  const splitKey = randomUUID();
  const mergedInto = order.status === "MERGED" && order.mergedIntoId ? await getOrder(ctx, order.mergedIntoId) : null;
  const people = Math.min(50, Math.max(0, Math.floor(Number(query.people ?? 0)) || 0));
  const evenShares = totals && people >= 2 ? splitEvenly(totals.grandTotal, people) : null;

  return (
    <div className="space-y-6">
      {order.deliveryStatus === "OUT_FOR_DELIVERY" && <AutoRefresh everyMs={8000} />}
      <div className="flex items-center gap-3">
        <Link href="/orders" className="text-sm text-stone-500 hover:underline">
          ← Orders
        </Link>
        <h1 className="text-xl font-semibold">
          Order #{order.number} · {order.table ? order.table.label : order.type === "DELIVERY" ? "Delivery" : "Takeaway"}
        </h1>
        <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs">{order.status.toLowerCase()}</span>
        {order.splitFromId && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">split bill</span>}
        {order.status !== "CANCELLED" && order.status !== "MERGED" && order.items.some((i) => i.status !== "CANCELLED") && (
          <PrintMenu kind="kitchen" id={order.id} label="Print kitchen ticket" queue={queueButton("kitchen", order.id)} defaultWidthMm={printCfg.paperWidthMm} defaultHeightMm={printCfg.paperHeightMm} className="ml-auto" />
        )}
      </div>

      {order.status === "MERGED" && (
        <p className="rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
          This bill was merged into{" "}
          {mergedInto ? (
            <Link href={`/orders/${mergedInto.id}`} className="font-medium underline">
              order #{mergedInto.number}
            </Link>
          ) : (
            "another order"
          )}
          . Its items are billed there.
        </p>
      )}

      {query.printed === "1" && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          Sent to the printer queue. A connected printer will print it; see Printing for the queue.
        </p>
      )}

      {typeof query.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {query.error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
            <h2 className="mb-2 font-semibold">Items</h2>
            {order.items.length === 0 ? (
              <p className="text-sm text-stone-500">Nothing added yet. Pick from the menu below.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {order.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      {item.quantity} × {item.name}
                      {item.addOns.length > 0 && (
                        <span className="block text-xs font-medium text-orange-700">{item.addOns.map((a) => a.name).join(" · ")}</span>
                      )}
                      {item.note && <span className="block text-xs text-stone-500">{item.note}</span>}
                      {item.cancelReason && (
                        <span className="block text-xs text-red-700">Cancelled: {item.cancelReason}</span>
                      )}
                    </span>
                    <span className="text-sm text-stone-600">{formatNpr(item.unitPrice * item.quantity)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[item.status]}`}>
                      {item.status.toLowerCase()}
                    </span>
                    {!closed &&
                      nextItemStatuses(item.status)
                        .filter((to) => to !== "CANCELLED")
                        .filter((to) => (to === "SERVED" ? can(ctx.role, "order.edit") : can(ctx.role, "kitchen.update")))
                        .map((to) => (
                          <form key={to} action={itemStatusAction.bind(null, order.id, item.id)}>
                            <input type="hidden" name="to" value={to} />
                            <button className="min-h-9 rounded-lg border border-stone-300 px-2 text-xs hover:bg-stone-50">
                              Mark {to.toLowerCase()}
                            </button>
                          </form>
                        ))}
                    {!closed && nextItemStatuses(item.status).includes("CANCELLED") && can(ctx.role, "order.cancelItem") && (
                      <form action={cancelItemAction.bind(null, order.id, item.id)} className="flex gap-1">
                        <input
                          name="reason"
                          placeholder="Reason"
                          required
                          minLength={3}
                          className="w-28 rounded-lg border border-stone-300 px-2 text-xs"
                        />
                        <button className="min-h-9 rounded-lg border border-red-300 px-2 text-xs text-red-700">
                          Cancel
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!closed && can(ctx.role, "order.edit") && (
            <section className="space-y-4 rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
              <h2 className="font-semibold">Menu</h2>
              {menu.map((cat) => (
                <div key={cat.id}>
                  <h3 className="mb-1 text-sm font-medium text-stone-500">{cat.name}</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {cat.items.map((mi) => {
                      const groups = addOns.get(mi.id) ?? [];
                      if (groups.length === 0) {
                        return (
                          <form key={mi.id} action={addItemAction.bind(null, order.id)}>
                            <input type="hidden" name="menuItemId" value={mi.id} />
                            <button className="min-h-14 w-full rounded-lg border border-stone-300 p-2 text-left hover:bg-stone-50">
                              <span className="block text-sm font-medium">{mi.name}</span>
                              <span className="text-xs text-stone-500">{formatNpr(mi.price)}</span>
                            </button>
                          </form>
                        );
                      }
                      // Dishes with choices open a small form: pick the size and extras, then add.
                      return (
                        <details key={mi.id} className="col-span-2 rounded-lg border border-orange-200 bg-orange-50/40 p-2 sm:col-span-3">
                          <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-2">
                            <span className="text-sm font-medium">{mi.name}</span>
                            <span className="text-xs text-stone-500">from {formatNpr(mi.price)} · choose options</span>
                          </summary>
                          <form action={addItemAction.bind(null, order.id)} className="mt-2 space-y-3 text-sm">
                            <input type="hidden" name="menuItemId" value={mi.id} />
                            {groups.map((g) => (
                              <fieldset key={g.id}>
                                <legend className="font-medium">
                                  {g.name} <span className="text-xs font-normal text-stone-500">{g.required ? "required" : "optional"}{g.multiple ? ", pick any" : ", pick one"}</span>
                                </legend>
                                <div className="mt-1 flex flex-wrap gap-2">
                                  {g.choices.map((c, idx) => (
                                    <label key={c.id} className="flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2">
                                      <input
                                        type={g.multiple ? "checkbox" : "radio"}
                                        name="addOn"
                                        value={c.id}
                                        required={g.required && !g.multiple && idx === 0 ? true : undefined}
                                      />
                                      {c.name}
                                      {c.price > 0 && <span className="text-xs text-stone-500">+{formatNpr(c.price)}</span>}
                                    </label>
                                  ))}
                                </div>
                              </fieldset>
                            ))}
                            <button className="min-h-10 rounded-lg bg-brand-600 px-4 font-medium text-white hover:bg-brand-700">Add to order</button>
                          </form>
                        </details>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>

        <aside className="space-y-4">
          {order.type === "DELIVERY" && order.deliveryStatus && (
            <section className="rounded-2xl border border-orange-200 bg-white p-4 shadow-sm" aria-label="Delivery">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Delivery</h2>
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                  {order.deliveryStatus.replaceAll("_", " ").toLowerCase()}
                </span>
              </div>
              <div className="mt-2 space-y-1 text-sm">
                {order.deliveryName && <p className="font-medium">{order.deliveryName}</p>}
                <p>
                  <a href={`tel:${order.deliveryPhone}`} className="text-brand-700 underline">
                    {order.deliveryPhone}
                  </a>
                </p>
                <p className="text-stone-600">{order.deliveryAddress}</p>
                {order.deliveryZoneName && (
                  <p className="text-stone-600">
                    Area: {order.deliveryZoneName} · fee {formatNpr(order.deliveryFee)}
                  </p>
                )}
                {order.riderName && (
                  <p className="text-stone-600">
                    Rider: {order.riderName}
                    {order.riderUserId && <span className="text-xs text-stone-400"> (own account)</span>}
                  </p>
                )}
                {riderLocation && (
                  <p className="text-stone-600">
                    Rider seen {riderLocation.ageMinutes < 1 ? "just now" : `${riderLocation.ageMinutes} min ago`} ·{" "}
                    <a href={riderLocation.url} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                      open in map
                    </a>
                  </p>
                )}
              </div>
              {order.type === "DELIVERY" && mp.branch && (mp.destination || mp.rider) && (
                <div className="mt-3">
                  <DeliveryMap branch={mp.branch} destination={mp.destination} rider={mp.rider} riderAgeMinutes={mp.riderAgeMinutes} />
                </div>
              )}
              {order.trackingToken && order.riderToken && order.status !== "CANCELLED" && order.status !== "MERGED" && (
                <div className="mt-3 space-y-2 rounded-xl bg-stone-50 p-3 text-xs">
                  <p className="font-medium text-stone-700">Links to share</p>
                  <label className="block">
                    <span className="text-stone-500">Customer tracking page</span>
                    <input readOnly value={`${appUrl}/track/${order.trackingToken}`} className="mt-1 block w-full px-2 py-1.5 text-xs" />
                  </label>
                  <label className="block">
                    <span className="text-stone-500">Rider page (address, phone, cash to collect)</span>
                    <input readOnly value={`${appUrl}/rider/${order.riderToken}`} className="mt-1 block w-full px-2 py-1.5 text-xs" />
                  </label>
                  <p className="text-stone-500">Anyone with a link can open it, so send each only to that person.</p>
                </div>
              )}
              {can(ctx.role, "order.edit") && order.status !== "CANCELLED" && order.status !== "MERGED" && (
                <div className="mt-3 space-y-2">
                  {order.deliveryStatus === "PREPARING" && riders.length > 0 && (
                    <form action={assignRiderAction.bind(null, order.id)} className="flex gap-2">
                      <select name="riderUserId" defaultValue={order.riderUserId ?? ""} aria-label="Rider account" required className="min-w-0 flex-1 px-2 py-2 text-sm">
                        <option value="">Choose a rider</option>
                        {riders.map((r) => (
                          <option key={r.userId} value={r.userId}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      <button className="min-h-10 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50">{order.riderUserId ? "Change" : "Assign"}</button>
                    </form>
                  )}
                  {order.deliveryStatus === "PREPARING" && (
                    <form action={deliveryStatusAction.bind(null, order.id)} className="flex gap-2">
                      <input type="hidden" name="status" value="OUT_FOR_DELIVERY" />
                      <input name="riderName" placeholder={order.riderUserId ? "Rider is on their own phone" : "Or type a rider name"} defaultValue={order.riderUserId ? "" : (order.riderName ?? "")} maxLength={60} className="min-w-0 flex-1 px-3 py-2 text-sm" />
                      <button className="min-h-10 rounded-lg bg-orange-600 px-3 text-sm font-medium text-white hover:bg-orange-700">Send out</button>
                    </form>
                  )}
                  {order.deliveryStatus === "OUT_FOR_DELIVERY" && (
                    <form action={deliveryStatusAction.bind(null, order.id)}>
                      <input type="hidden" name="status" value="DELIVERED" />
                      <button className="min-h-10 w-full rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700">Mark delivered</button>
                    </form>
                  )}
                  {(order.deliveryStatus === "PREPARING" || order.deliveryStatus === "OUT_FOR_DELIVERY") && (
                    <form action={deliveryStatusAction.bind(null, order.id)}>
                      <input type="hidden" name="status" value="FAILED" />
                      <button className="text-xs text-red-700 underline">Delivery failed</button>
                    </form>
                  )}
                </div>
              )}
            </section>
          )}
          {canCustomer && loyalty && (
            <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm" aria-label="Customer">
              <h2 className="font-semibold">Customer</h2>
              {loyalty.customer ? (
                <div className="mt-2 space-y-2 text-sm">
                  <p>
                    <span className="font-medium">{loyalty.customer.name ?? "No name yet"}</span>
                    <br />
                    <span className="text-stone-600">{loyalty.customer.phone}</span>
                  </p>
                  <p className="text-stone-600">
                    {loyalty.customer.pointsBalance} points · {loyalty.customer.visitCount} visit
                    {loyalty.customer.visitCount === 1 ? "" : "s"}
                  </p>
                  <CustomerOsPoints ctx={ctx} customerId={loyalty.customer.id} />
                  {loyalty.confirmed ? (
                    <p className="text-green-800">Confirmed in person</p>
                  ) : (
                    <div className="rounded-lg bg-amber-50 p-2 ring-1 ring-amber-200">
                      <p>Number typed by the guest. Not confirmed, so points cannot be spent yet.</p>
                      <form action={confirmCustomerAction.bind(null, order.id)} className="mt-2">
                        <button className="min-h-9 rounded-lg border border-amber-400 bg-white px-3">
                          This is the customer
                        </button>
                      </form>
                    </div>
                  )}
                  <form action={detachCustomerAction.bind(null, order.id)}>
                    <button className="text-xs text-stone-500 underline">Remove customer</button>
                  </form>
                </div>
              ) : (
                <form action={attachCustomerAction.bind(null, order.id)} className="mt-2 space-y-2 text-sm">
                  <label className="block font-medium">
                    Phone number
                    <input
                      name="phone"
                      type="tel"
                      inputMode="tel"
                      required
                      autoComplete="off"
                      placeholder="98XXXXXXXX"
                      className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2"
                    />
                  </label>
                  <label className="block font-medium">
                    Name (optional)
                    <input name="name" maxLength={80} className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2" />
                  </label>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" name="consent" className="mt-1 h-4 w-4" />
                    <span>The customer agrees to receive offers by message</span>
                  </label>
                  <button className="min-h-9 rounded-lg border border-stone-300 px-3">Add customer</button>
                  {loyalty.settings.enabled && <p className="text-xs text-stone-500">They earn points on this bill.</p>}
                </form>
              )}
            </section>
          )}
          {canRestructure && options && activeItems.length > 0 && (
            <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm" aria-label="Move, merge or split">
              <h2 className="font-semibold">Move, merge or split</h2>

              {order.tableId && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium">Move to another table</summary>
                  {options.freeTables.length === 0 ? (
                    <p className="mt-2 text-sm text-stone-500">No free table right now.</p>
                  ) : (
                    <form action={moveTableAction.bind(null, order.id)} className="mt-2 space-y-2 text-sm">
                      <select name="tableId" required className="block w-full rounded-lg border border-stone-300 px-2 py-2">
                        {options.freeTables.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.area.name} · {t.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-stone-500">
                        Every bill at this table moves. Guests must scan the QR code on the new table to keep ordering.
                      </p>
                      <button className="min-h-9 rounded-lg border border-stone-300 px-3">Move</button>
                    </form>
                  )}
                </details>
              )}

              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-medium">Merge into another bill</summary>
                {options.mergeTargets.length === 0 ? (
                  <p className="mt-2 text-sm text-stone-500">There is no other open bill.</p>
                ) : (
                  <form action={mergeAction.bind(null, order.id)} className="mt-2 space-y-2 text-sm">
                    <select name="targetId" required className="block w-full rounded-lg border border-stone-300 px-2 py-2">
                      {options.mergeTargets.map((m) => (
                        <option key={m.id} value={m.id}>
                          #{m.number} · {m.tableLabel ?? "Takeaway"} · {m.itemCount} item{m.itemCount === 1 ? "" : "s"}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-stone-500">
                      All items move to that bill and this one is closed. The table is freed if nothing else is open on it.
                    </p>
                    <button className="min-h-9 rounded-lg border border-stone-300 px-3">Merge</button>
                  </form>
                )}
              </details>

              {activeItems.reduce((n, i) => n + i.quantity, 0) > 1 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium">Split this bill</summary>
                  <form action={splitAction.bind(null, order.id)} className="mt-2 space-y-2 text-sm">
                    <input type="hidden" name="idempotencyKey" value={splitKey} />
                    <p className="text-xs text-stone-500">
                      Choose what moves to a new bill at the same table. Each bill is paid and invoiced on its own.
                    </p>
                    <ul className="space-y-1">
                      {activeItems.map((i) => (
                        <li key={i.id} className="flex items-center justify-between gap-2">
                          <label htmlFor={`qty_${i.id}`} className="min-w-0 flex-1 truncate">
                            {i.name} <span className="text-stone-500">(of {i.quantity})</span>
                          </label>
                          <input
                            id={`qty_${i.id}`}
                            name={`qty_${i.id}`}
                            type="number"
                            min={0}
                            max={i.quantity}
                            defaultValue={0}
                            className="w-16 rounded-lg border border-stone-300 px-2 py-1.5 text-right"
                          />
                        </li>
                      ))}
                    </ul>
                    <button className="min-h-9 rounded-lg border border-stone-300 px-3">Split off</button>
                  </form>
                </details>
              )}
            </section>
          )}
          {canCancel && (
            <details className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
              <summary className="cursor-pointer text-sm font-medium text-red-700">Cancel this order</summary>
              <form action={cancelOrderAction.bind(null, order.id)} className="mt-2 space-y-2 text-sm">
                <p className="text-xs text-stone-500">
                  {hasFood
                    ? "The order and all its items are cancelled and the table is freed. Nothing is deleted."
                    : "This order is empty. It will be closed."}
                </p>
                <label className="block font-medium">
                  Reason
                  <input name="reason" required minLength={3} maxLength={200} className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2" />
                </label>
                <button className="min-h-9 rounded-lg bg-red-700 px-3 text-white">Cancel order</button>
              </form>
            </details>
          )}
          {order.status === "CANCELLED" && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
              This order was cancelled{order.cancelReason ? `: ${order.cancelReason}` : "."}
            </p>
          )}
          {order.invoice ? (
            <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">Invoice #{order.invoice.number}</h2>
                <PrintMenu kind="invoice" id={order.invoice.id} label="Print receipt" queue={queueButton("invoice", order.invoice.id)} defaultWidthMm={printCfg.paperWidthMm} defaultHeightMm={printCfg.paperHeightMm} />
              </div>
              {order.invoice.creditNotes.length > 0 && (
                <div className="mt-1 space-y-1 rounded-lg bg-red-50 p-2 text-sm text-red-900">
                  {order.invoice.creditNotes.map((c) => (
                    <p key={c.id}>
                      Credit note #{c.number}: {formatNpr(c.grandTotal)} {c.partial ? "(part)" : ""}. {c.reason}{" "}
                      <PrintMenu kind="credit-note" id={c.id} label="Print" queue={queueButton("credit-note", c.id)} defaultWidthMm={printCfg.paperWidthMm} defaultHeightMm={printCfg.paperHeightMm} className="inline-block" />
                    </p>
                  ))}
                  <p className="font-medium">
                    {refundLeft <= 0 ? "Refunded in full." : `Refunded ${formatNpr(refundedSoFar)} so far; ${formatNpr(refundLeft)} left.`}
                  </p>
                </div>
              )}
              <Totals
                rows={[
                  ["Subtotal", order.invoice.subtotal],
                  ["Discount", -order.invoice.discount],
                  ["Reward discount", -order.invoice.loyaltyDiscount],
                  ["Service charge", order.invoice.serviceCharge],
                  ["VAT", order.invoice.vat],
                  ...(order.invoice.deliveryFee ? ([["Delivery fee", order.invoice.deliveryFee]] as [string, number][]) : []),
                  ["Round off", order.invoice.roundOff],
                ]}
                total={order.invoice.grandTotal}
              />
              {(order.invoice.pointsEarned > 0 || order.invoice.pointsRedeemed > 0) && (
                <p className="mt-2 text-sm text-stone-600">
                  {order.invoice.pointsRedeemed > 0 && <>Spent {order.invoice.pointsRedeemed} points. </>}
                  {order.invoice.pointsEarned > 0 && <>Earned {order.invoice.pointsEarned} points.</>}
                </p>
              )}
              <ul className="mt-2 text-sm text-stone-600">
                {order.invoice.payments.map((p) => (
                  <li key={p.id}>
                    {p.method.toLowerCase()}: {formatNpr(p.amount)}
                  </li>
                ))}
              </ul>
              {canRefund && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-red-700">Refund this invoice</summary>
                  <form action={refundInvoiceAction.bind(null, order.id, order.invoice.id)} className="mt-2 space-y-2 text-sm">
                    <p className="text-xs text-stone-500">
                      Up to {formatNpr(refundLeft)} can still be refunded. Leave the amount empty to refund all of it. A part refund takes its
                      share of VAT, service charge and discount, and of the customer&apos;s points. A credit note is issued each time. This
                      cannot be undone.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <label className="block font-medium">
                        Amount (Rs)
                        <input name="amount" type="number" min="0.01" step="0.01" max={refundLeft / 100} placeholder={`${refundLeft / 100} (all)`} className="mt-1 block w-36 rounded-lg border border-stone-300 px-3 py-2" />
                      </label>
                      <label className="block font-medium">
                        Hand back by
                        <select name="method" className="mt-1 block rounded-lg border border-stone-300 px-3 py-2">
                          <option value="">Same as paid</option>
                          <option value="CASH">Cash</option>
                          <option value="QR">QR</option>
                          <option value="CARD">Card</option>
                        </select>
                      </label>
                    </div>
                    {usedReward && !usedReward.returned && (
                      <label className="flex items-start gap-2 font-medium">
                        <input type="checkbox" name="returnReward" className="mt-1 h-4 w-4" />
                        <span>
                          Give back the Customer OS reward used on this bill
                          <span className="block text-xs font-normal text-stone-500">Only with the refund that finishes the whole bill. The customer gets the points back.</span>
                        </span>
                      </label>
                    )}
                    {usedReward?.returned && <p className="text-xs text-stone-500">The reward used on this bill has already been given back.</p>}
                    <label className="block font-medium">
                      Reason
                      <input name="reason" required minLength={3} maxLength={200} className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2" />
                    </label>
                    <button className="min-h-9 rounded-lg bg-red-700 px-3 text-white">Refund</button>
                  </form>
                </details>
              )}
            </section>
          ) : totals ? (
            <section className="rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
              <h2 className="font-semibold">Bill</h2>
              <form className="my-2 flex items-end gap-2" method="get">
                <label className="text-xs font-medium">
                  Discount %
                  <input
                    name="discount"
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    defaultValue={discountPct || ""}
                    className="mt-1 block w-24 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                  />
                </label>
                {maxBlocks > 0 && loyalty && (
                  <label className="text-xs font-medium">
                    Use points
                    <select
                      name="redeem"
                      defaultValue={redeemBlocks}
                      className="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                    >
                      <option value={0}>None</option>
                      {Array.from({ length: maxBlocks }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n * loyalty.settings.redeemPoints} pts (-{formatNpr(n * loyalty.settings.redeemValue)})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {billRewards.rewards.length > 0 && (
                  <label className="text-xs font-medium">
                    Use Customer OS reward
                    <select
                      name="reward"
                      defaultValue={chosenReward?.id ?? ""}
                      className="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">None</option>
                      {billRewards.rewards.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.type === "FREE_ITEM" ? "a free item" : `-${formatNpr(r.valueMinor ?? 0)}`}, uses {r.cost} pts)
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {chosenReward?.type === "FREE_ITEM" && (
                  <label className="text-xs font-medium">
                    Free item
                    <select name="free" defaultValue={freeItem?.id ?? ""} className="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm">
                      {liveItems.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({formatNpr(i.unitPrice)})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm">Apply</button>
              </form>
              {billRewards.state === "unavailable" && (
                <p className="mb-2 text-xs text-stone-500">Customer OS rewards are unavailable right now.</p>
              )}
              {billError && (
                <p role="alert" className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-800">
                  {billError}
                </p>
              )}
              <Totals
                rows={[
                  ["Subtotal", totals.subtotal],
                  ["Discount", -totals.discount],
                  ["Reward discount", -totals.loyaltyDiscount],
                  ["Service charge", totals.serviceCharge],
                  ["VAT", totals.vat],
                  ...(totals.deliveryFee ? ([["Delivery fee", totals.deliveryFee]] as [string, number][]) : []),
                  ["Round off", totals.roundOff],
                ]}
                total={totals.grandTotal}
              />
              {totals.pointsToEarn > 0 && (
                <p className="mt-1 text-xs text-green-800">The customer earns {totals.pointsToEarn} points on this bill.</p>
              )}
              <form className="mt-2 flex items-end gap-2 text-xs" method="get">
                {discountPct > 0 && <input type="hidden" name="discount" value={discountPct} />}
                {redeemBlocks > 0 && <input type="hidden" name="redeem" value={redeemBlocks} />}
                {chosenReward && <input type="hidden" name="reward" value={chosenReward.id} />}
                {freeItem && <input type="hidden" name="free" value={freeItem.id} />}
                <label className="font-medium">
                  Share between
                  <input
                    name="people"
                    type="number"
                    min={2}
                    max={50}
                    defaultValue={people >= 2 ? people : ""}
                    placeholder="people"
                    className="mt-1 block w-20 rounded-lg border border-stone-300 px-2 py-1.5"
                  />
                </label>
                <button className="min-h-8 rounded-lg border border-stone-300 px-2">Show</button>
              </form>
              {evenShares && (
                <ul className="mt-1 text-xs text-stone-600">
                  {[...new Set(evenShares)].map((amount) => (
                    <li key={amount}>
                      {evenShares.filter((x) => x === amount).length} x {formatNpr(amount)}
                    </li>
                  ))}
                  <li className="text-stone-400">Only a guide. To pay separately, split the bill.</li>
                </ul>
              )}
              {can(ctx.role, "bill.checkout") && (
                <form action={checkoutAction.bind(null, order.id)} className="mt-3 space-y-2">
                  <input type="hidden" name="discountPercent" value={discountPct} />
                  <input type="hidden" name="redeemPoints" value={totals.redeemPoints} />
                  <input type="hidden" name="redeemBlocks" value={redeemBlocks} />
                  {chosenReward && <input type="hidden" name="rewardId" value={chosenReward.id} />}
                  {freeItem && <input type="hidden" name="freeItemId" value={freeItem.id} />}
                  {chosenReward && <p className="text-xs text-green-800">{chosenReward.name} uses {chosenReward.cost} Customer OS points when you take payment.</p>}
                  <p className="text-xs text-stone-500">Payments must add up to {formatNpr(totals.grandTotal)}.</p>
                  {(["cash", "qr", "card"] as const).map((m, idx) => (
                    <label key={m} className="flex items-center justify-between text-sm">
                      <span className="capitalize">{m === "qr" ? "QR" : m} (Rs)</span>
                      <input
                        name={m}
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={idx === 0 ? (totals.grandTotal / 100).toFixed(2) : ""}
                        key={`${m}-${totals.grandTotal}`}
                        className="w-28 rounded-lg border border-stone-300 px-2 py-1.5 text-right"
                      />
                    </label>
                  ))}
                  <button className="min-h-11 w-full rounded-lg bg-green-700 px-4 py-2 font-medium text-white">
                    Take payment
                  </button>
                </form>
              )}
            </section>
          ) : (
            <p className="text-sm text-stone-500">The bill appears once there is an item.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Totals({ rows, total }: { rows: [string, number][]; total: number }) {
  return (
    <dl className="mt-1 space-y-1 text-sm">
      {rows
        .filter(([, v]) => v !== 0)
        .map(([label, value]) => (
          <div key={label} className="flex justify-between">
            <dt className="text-stone-600">{label}</dt>
            <dd>{formatNpr(value)}</dd>
          </div>
        ))}
      <div className="flex justify-between border-t border-stone-200 pt-1 text-base font-semibold">
        <dt>Total</dt>
        <dd>{formatNpr(total)}</dd>
      </div>
    </dl>
  );
}
