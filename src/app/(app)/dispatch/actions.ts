"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { assignRider } from "@/features/orders/server/service";
import { recordHandIn, recordPayout, setRiderPay } from "@/features/delivery/server/dispatch";
import { assignBatchRider, cancelBatch, createBatch, removeFromBatch, startBatch } from "@/features/delivery/server/batches";

const BACK = "/dispatch";
const rupeesToPaisa = (v: FormDataEntryValue | null) => Math.round(Number(v || 0) * 100);
const done = () => {
  revalidatePath("/", "layout");
  redirect(BACK);
};

export async function dispatchAssignAction(orderId: string, formData: FormData) {
  const ctx = await requireTenant("order.edit");
  const riderUserId = z.string().min(1).max(60).parse(formData.get("riderUserId"));
  await guarded(BACK, () => assignRider(ctx, orderId, riderUserId));
  done();
}

export async function handInAction(riderUserId: string, formData: FormData) {
  const ctx = await requireTenant("rider.settle");
  await guarded(BACK, () => recordHandIn(ctx, riderUserId, rupeesToPaisa(formData.get("amount")), String(formData.get("note") ?? "")));
  done();
}

export async function payoutAction(riderUserId: string, formData: FormData) {
  const ctx = await requireTenant("rider.settle");
  await guarded(BACK, () => recordPayout(ctx, riderUserId, rupeesToPaisa(formData.get("amount")), String(formData.get("note") ?? "")));
  done();
}

export async function setRiderPayAction(riderUserId: string, formData: FormData) {
  const ctx = await requireTenant("staff.manage");
  await guarded(BACK, () => setRiderPay(ctx, riderUserId, rupeesToPaisa(formData.get("pay"))));
  done();
}

/** Group the ticked deliveries into one run, optionally giving it to a rider. */
export async function makeRunAction(formData: FormData) {
  const ctx = await requireTenant("order.edit");
  const orderIds = formData.getAll("order").map(String);
  const riderUserId = String(formData.get("riderUserId") ?? "") || undefined;
  await guarded(BACK, () => createBatch(ctx, { orderIds, riderUserId }));
  done();
}

export async function assignRunAction(batchId: string, formData: FormData) {
  const ctx = await requireTenant("order.edit");
  const riderUserId = z.string().min(1).max(60).parse(formData.get("riderUserId"));
  await guarded(BACK, () => assignBatchRider(ctx, batchId, riderUserId));
  done();
}

export async function startRunAction(batchId: string) {
  const ctx = await requireTenant("order.edit");
  await guarded(BACK, () => startBatch(ctx, batchId));
  done();
}

export async function cancelRunAction(batchId: string) {
  const ctx = await requireTenant("order.edit");
  await guarded(BACK, () => cancelBatch(ctx, batchId));
  done();
}

export async function removeStopAction(orderId: string) {
  const ctx = await requireTenant("order.edit");
  await guarded(BACK, () => removeFromBatch(ctx, orderId));
  done();
}
