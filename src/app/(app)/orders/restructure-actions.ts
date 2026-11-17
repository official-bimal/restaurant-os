"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { mergeOrders, moveToTable, splitOrder } from "@/features/orders/server/table-ops";

export async function moveTableAction(orderId: string, formData: FormData) {
  const ctx = await requireTenant("order.restructure");
  const tableId = z.string().min(1).parse(formData.get("tableId"));
  await guarded(`/orders/${orderId}`, () => moveToTable(ctx, orderId, tableId));
  revalidatePath("/orders", "layout");
  redirect(`/orders/${orderId}`);
}

export async function mergeAction(orderId: string, formData: FormData) {
  const ctx = await requireTenant("order.restructure");
  const targetId = z.string().min(1).parse(formData.get("targetId"));
  await guarded(`/orders/${orderId}`, () => mergeOrders(ctx, orderId, targetId));
  revalidatePath("/orders", "layout");
  // This bill no longer exists on its own: carry on at the one it was merged into.
  redirect(`/orders/${targetId}`);
}

export async function splitAction(orderId: string, formData: FormData) {
  const ctx = await requireTenant("order.restructure");
  const idempotencyKey = z.string().min(8).max(100).parse(formData.get("idempotencyKey"));
  const selections: { itemId: string; quantity: number }[] = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("qty_")) continue;
    const quantity = Math.trunc(Number(value));
    if (Number.isFinite(quantity) && quantity > 0) selections.push({ itemId: name.slice(4), quantity });
  }
  const created = await guarded(`/orders/${orderId}`, () => splitOrder(ctx, orderId, selections, idempotencyKey));
  revalidatePath("/orders", "layout");
  redirect(`/orders/${created.id}`);
}
