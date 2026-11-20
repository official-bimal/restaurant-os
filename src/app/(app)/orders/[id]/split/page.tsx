import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireTenant } from "@/server/auth";
import { db } from "@/server/db";
import { getOrder } from "@/features/orders/server/service";
import { splitByItemAction } from "../../restructure-actions";
import { SplitEditor } from "./split-editor";

export const dynamic = "force-dynamic";

export default async function SplitByItemPage({ params, searchParams }: PageProps<"/orders/[id]/split">) {
  const ctx = await requireTenant("order.restructure");
  const { id } = await params;
  const q = await searchParams;
  const order = await getOrder(ctx, id);
  if (!order) notFound();
  const business = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { serviceChargeBps: true, vatMode: true, vatBps: true, vatAppliesToServiceCharge: true, roundToRupee: true } });
  const items = order.items.filter((i) => i.status !== "CANCELLED");
  const closed = ["PAID", "CANCELLED", "MERGED"].includes(order.status) || !!order.invoice;
  const where = order.table ? order.table.label : order.type === "TAKEAWAY" ? "Takeaway" : order.type;
  // One key per page view: tapping the button twice cannot make two sets of bills.
  const key = randomUUID().replace(/-/g, "");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/orders/${order.id}`} className="text-sm text-stone-500 hover:underline">
          ← Order #{order.number}
        </Link>
        <h1 className="text-xl font-semibold">Split the bill by item · {where}</h1>
      </div>
      {typeof q.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {q.error}
        </p>
      )}
      {closed ? (
        <p className="card p-5 text-stone-600">This bill is already {order.status === "PAID" || order.invoice ? "paid" : "closed"}, so it cannot be split.</p>
      ) : order.type === "DELIVERY" ? (
        <p className="card p-5 text-stone-600">A delivery bill cannot be split between guests.</p>
      ) : items.length === 0 ? (
        <p className="card p-5 text-stone-600">There is nothing on this bill yet.</p>
      ) : (
        <>
          <p className="text-sm text-stone-600">
            Give each dish to the guest who ordered it, or share it equally between several. Each guest then gets a bill of their own at this table, with their own service charge and VAT, to pay and invoice separately. Nothing is paid or printed yet.
          </p>
          <SplitEditor
            action={splitByItemAction.bind(null, order.id)}
            idempotencyKey={key}
            items={items.map((i) => ({ id: i.id, name: i.name, unitPrice: i.unitPrice, quantity: i.quantity, status: i.status, complimentary: i.complimentary, note: i.note, extras: i.addOns.map((a) => a.name) }))}
            config={{ serviceChargeBps: business.serviceChargeBps, vatMode: business.vatMode, vatBps: business.vatBps, vatAppliesToServiceCharge: business.vatAppliesToServiceCharge, roundToRupee: business.roundToRupee }}
            firstLabel={order.label ?? ""}
          />
        </>
      )}
    </div>
  );
}
