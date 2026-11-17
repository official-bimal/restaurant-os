import type { Tx } from "@/server/audit";
import { deriveOrderStatus } from "@/features/orders/status";

/** Re-derive an order's status from its items (the order has no status of its own while open). */
export async function syncOrderStatus(tx: Tx, businessId: string, orderId: string) {
  const order = await tx.order.findFirstOrThrow({
    where: { id: orderId, businessId },
    include: { items: { select: { status: true } } },
  });
  const status = deriveOrderStatus(order.items, {
    settled: order.status === "PAID",
    cancelled: order.status === "CANCELLED",
    merged: order.status === "MERGED",
  });
  if (status !== order.status) {
    await tx.order.update({ where: { businessId_id: { businessId, id: orderId } }, data: { status } });
  }
}
