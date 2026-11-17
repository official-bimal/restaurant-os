import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { addItem, createOrder } from "./service";
import type { OfflineOrder, SyncOutcome } from "../offline";

/**
 * Apply one order that was taken offline. Safe to repeat: the key makes the order itself idempotent, and an order that
 * already has its items is reported as done instead of getting them a second time. If an item is refused (for example
 * a dish switched off since), the items before it stay on the order and the phone is told exactly what happened, so
 * nothing is silently lost or doubled.
 */
export async function applyOfflineOrder(ctx: TenantContext, o: OfflineOrder): Promise<SyncOutcome> {
  if (o.branchId !== ctx.branchId) {
    return { ok: false, retry: false, error: "This order was taken at a different branch. Switch to that branch and send it again." };
  }
  try {
    const order = await createOrder(ctx, { type: o.type, tableId: o.type === "DINE_IN" ? o.tableId : null, idempotencyKey: o.key });
    const have = await db.orderItem.count({ where: { businessId: ctx.businessId, orderId: order.id, status: { not: "CANCELLED" } } });
    if (have > 0) return { ok: true, orderId: order.id, number: order.number, repeat: true };

    const skipped: string[] = [];
    for (const line of o.items) {
      try {
        await addItem(ctx, order.id, { menuItemId: line.menuItemId, quantity: line.quantity, note: line.note });
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        skipped.push(e.message);
      }
    }
    if (skipped.length > 0) {
      return {
        ok: false,
        retry: false,
        error: `Order #${order.number} was created but ${skipped.length} item${skipped.length === 1 ? " was" : "s were"} refused (${skipped[0]}). Check the order and add what is missing.`,
      };
    }
    return { ok: true, orderId: order.id, number: order.number, repeat: false };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, retry: false, error: e.message };
    throw e;
  }
}
