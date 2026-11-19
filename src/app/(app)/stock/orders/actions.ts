"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import {
  archiveSupplier,
  cancelPurchaseOrder,
  closeShort,
  createDraftFromLowStock,
  createPurchaseOrder,
  createSupplier,
  markOrdered,
  receiveDelivery,
} from "@/features/purchasing/server/service";

const LIST = "/stock/orders";
const text = (max: number) => z.string().max(max);
const whole = (v: FormDataEntryValue | null) => Math.trunc(Number(v ?? 0));
const rupeesToPaisa = (v: FormDataEntryValue | null) => Math.round(Number(v ?? 0) * 100);

function done(path: string): never {
  revalidatePath("/stock", "layout");
  redirect(path);
}

export async function createSupplierAction(formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const input = {
    name: text(200).parse(formData.get("name") ?? ""),
    phone: text(40).parse(formData.get("phone") ?? ""),
    notes: text(400).parse(formData.get("notes") ?? ""),
    panNumber: text(20).parse(formData.get("panNumber") ?? ""),
  };
  await guarded(LIST, () => createSupplier(ctx, input));
  done(LIST);
}

export async function archiveSupplierAction(id: string) {
  const ctx = await requireTenant("stock.manage");
  await guarded(LIST, () => archiveSupplier(ctx, id));
  done(LIST);
}

/** Every stock item arrives as "qty_<id>"; a blank or zero amount means it is not on the order. */
export async function createOrderAction(formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const supplierId = text(60).parse(formData.get("supplierId") ?? "");
  const lines: { stockItemId: string; quantity: number }[] = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("qty_")) continue;
    const quantity = whole(value as string);
    if (quantity > 0) lines.push({ stockItemId: name.slice(4), quantity });
  }
  const po = await guarded(LIST, () =>
    createPurchaseOrder(ctx, {
      supplierId,
      lines,
      note: text(400).parse(formData.get("note") ?? ""),
      expectedOn: text(20).parse(formData.get("expectedOn") ?? ""),
    }),
  );
  done(`${LIST}/${po.id}`);
}

export async function draftFromLowStockAction(formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const supplierId = text(60).parse(formData.get("supplierId") ?? "");
  const po = await guarded(LIST, () => createDraftFromLowStock(ctx, supplierId));
  done(`${LIST}/${po.id}`);
}

export async function markOrderedAction(id: string) {
  const ctx = await requireTenant("stock.manage");
  await guarded(`${LIST}/${id}`, () => markOrdered(ctx, id));
  done(`${LIST}/${id}`);
}

/** Fields are "qty_<lineId>" and "paid_<lineId>" (rupees). */
export async function receiveAction(id: string, formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const receipt: { lineId: string; quantity: number; totalCost: number }[] = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("qty_")) continue;
    const lineId = name.slice(4);
    const quantity = whole(value as string);
    if (quantity > 0) receipt.push({ lineId, quantity, totalCost: rupeesToPaisa(formData.get(`paid_${lineId}`)) });
  }
  await guarded(`${LIST}/${id}`, () => receiveDelivery(ctx, id, receipt));
  done(`${LIST}/${id}`);
}

export async function closeShortAction(id: string, formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const reason = text(300).parse(formData.get("reason") ?? "");
  await guarded(`${LIST}/${id}`, () => closeShort(ctx, id, reason));
  done(`${LIST}/${id}`);
}

export async function cancelOrderAction(id: string, formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const reason = text(300).parse(formData.get("reason") ?? "");
  await guarded(`${LIST}/${id}`, () => cancelPurchaseOrder(ctx, id, reason));
  done(`${LIST}/${id}`);
}
