"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { cancelOrder, refundInvoice } from "@/features/orders/server/void";

const reasonSchema = z.string().max(300);

export async function cancelOrderAction(orderId: string, formData: FormData) {
  const ctx = await requireTenant();
  const reason = reasonSchema.parse(formData.get("reason") ?? "");
  await guarded(`/orders/${orderId}`, () => cancelOrder(ctx, orderId, reason));
  revalidatePath("/orders", "layout");
  redirect(`/orders/${orderId}`);
}

export async function refundInvoiceAction(orderId: string, invoiceId: string, formData: FormData) {
  const ctx = await requireTenant("bill.refund");
  const reason = reasonSchema.parse(formData.get("reason") ?? "");
  const raw = String(formData.get("amount") ?? "").trim();
  const amount = raw ? Math.round(Number(raw) * 100) : undefined;
  if (amount !== undefined && !Number.isFinite(amount)) redirect(`/orders/${orderId}?error=${encodeURIComponent("Enter the amount as a number.")}`);
  const method = String(formData.get("method") ?? "") || undefined;
  await guarded(`/orders/${orderId}`, () => refundInvoice(ctx, invoiceId, reason, { amount, method }));
  revalidatePath("/orders", "layout");
  revalidatePath("/bills");
  redirect(`/orders/${orderId}`);
}
