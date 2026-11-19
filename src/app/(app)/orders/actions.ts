"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { guarded } from "@/server/guarded";
import {
  addItem,
  addItems,
  cancelItem,
  checkout,
  assignRider,
  createOrder,
  setDeliveryStatus,
  setItemStatus,
} from "@/features/orders/server/service";
import type { DiscountInput } from "@/features/billing/calc";

const createSchema = z.object({
  type: z.enum(["DINE_IN", "TAKEAWAY", "QUICK_BILL", "DELIVERY"]),
  tableId: z.string().optional(),
  deliveryName: z.string().max(200).optional(),
  deliveryPhone: z.string().max(60).optional(),
  deliveryAddress: z.string().max(400).optional(),
  deliveryZoneId: z.string().max(60).optional(),
  deliveryDistanceKm: z.string().max(10).optional(),
  deliveryLocation: z.string().max(600).optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export async function createOrderAction(formData: FormData) {
  const ctx = await requireTenant();
  const input = createSchema.parse({
    type: formData.get("type"),
    tableId: (formData.get("tableId") as string) || undefined,
    idempotencyKey: formData.get("idempotencyKey"),
    deliveryName: (formData.get("deliveryName") as string) || undefined,
    deliveryPhone: (formData.get("deliveryPhone") as string) || undefined,
    deliveryAddress: (formData.get("deliveryAddress") as string) || undefined,
    deliveryZoneId: (formData.get("deliveryZoneId") as string) || undefined,
    deliveryDistanceKm: (formData.get("deliveryDistanceKm") as string) || undefined,
    deliveryLocation: (formData.get("deliveryLocation") as string) || undefined,
  });
  const order = await guarded("/orders", () =>
    createOrder(ctx, {
      type: input.type,
      tableId: input.tableId,
      idempotencyKey: input.idempotencyKey,
      delivery: { name: input.deliveryName, phone: input.deliveryPhone, address: input.deliveryAddress, zoneId: input.deliveryZoneId, distanceKm: input.deliveryDistanceKm, location: input.deliveryLocation },
    }),
  );
  redirect(`/orders/${order.id}`);
}

export async function addItemAction(orderId: string, formData: FormData) {
  const ctx = await requireTenant();
  const input = z
    .object({
      menuItemId: z.string(),
      quantity: z.coerce.number().int().min(1).max(99).default(1),
      note: z.string().max(200).optional(),
      addOnIds: z.array(z.string().max(60)).max(30),
    })
    .parse({
      menuItemId: formData.get("menuItemId"),
      quantity: formData.get("quantity") || 1,
      note: formData.get("note") || undefined,
      addOnIds: formData.getAll("addOn").map(String),
    });
  await guarded(`/orders/${orderId}`, () => addItem(ctx, orderId, input));
  revalidatePath(`/orders/${orderId}`);
  redirect(`/orders/${orderId}`);
}

const linesSchema = z
  .array(
    z.object({
      menuItemId: z.string().min(1).max(60),
      quantity: z.number().int().min(1).max(99),
      addOnIds: z.array(z.string().min(1).max(60)).max(30).optional(),
      note: z.string().trim().max(120).optional(),
    }),
  )
  .min(1)
  .max(40);

export type AddItemsResult = { ok: true; added: number } | { ok: false; error: string };

/** The dishes a waiter picked on their phone, sent in one go. All of them are added, or none (and the message says why). */
export async function addItemsAction(orderId: string, lines: unknown): Promise<AddItemsResult> {
  const ctx = await requireTenant();
  const parsed = linesSchema.safeParse(lines);
  if (!parsed.success) return { ok: false, error: "Something is wrong with that list. Please try again." };
  try {
    const added = await addItems(ctx, orderId, parsed.data);
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders");
    return { ok: true, added: added.length };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function assignRiderAction(orderId: string, formData: FormData) {
  const ctx = await requireTenant();
  const riderUserId = z.string().min(1).max(60).parse(formData.get("riderUserId"));
  await guarded(`/orders/${orderId}`, () => assignRider(ctx, orderId, riderUserId));
  revalidatePath("/orders", "layout");
  redirect(`/orders/${orderId}`);
}

export async function deliveryStatusAction(orderId: string, formData: FormData) {
  const ctx = await requireTenant();
  const status = z.enum(["OUT_FOR_DELIVERY", "DELIVERED", "FAILED"]).parse(formData.get("status"));
  const riderName = z.string().max(100).parse(formData.get("riderName") ?? "");
  const riderUserId = z.string().max(60).parse(formData.get("riderUserId") ?? "") || undefined;
  await guarded(`/orders/${orderId}`, () => setDeliveryStatus(ctx, orderId, { status, riderName, riderUserId }));
  revalidatePath("/orders", "layout");
  redirect(`/orders/${orderId}`);
}

export async function itemStatusAction(orderId: string, itemId: string, formData: FormData) {
  const ctx = await requireTenant();
  const to = z.enum(["PENDING", "PREPARING", "READY", "SERVED"]).parse(formData.get("to"));
  await guarded(`/orders/${orderId}`, () => setItemStatus(ctx, itemId, to));
  revalidatePath("/orders", "layout");
  redirect(`/orders/${orderId}`);
}

export async function cancelItemAction(orderId: string, itemId: string, formData: FormData) {
  const ctx = await requireTenant();
  const reason = z.string().parse(formData.get("reason") ?? "");
  await guarded(`/orders/${orderId}`, () => cancelItem(ctx, itemId, reason));
  revalidatePath("/orders", "layout");
  redirect(`/orders/${orderId}`);
}

const rupeesToPaisa = (v: FormDataEntryValue | null) => Math.round(Number(v || 0) * 100);

export async function checkoutAction(orderId: string, formData: FormData) {
  const ctx = await requireTenant();
  const pct = Number(formData.get("discountPercent") || 0);
  if (!(pct >= 0 && pct <= 100)) redirect(`/orders/${orderId}?error=${encodeURIComponent("Discount must be 0 to 100.")}`);
  const redeemPoints = Math.max(0, Math.floor(Number(formData.get("redeemPoints") || 0)) || 0);
  const discount: DiscountInput =
    pct > 0 ? { kind: "percent", bps: Math.round(pct * 100) } : { kind: "none" };
  const payments = (
    [
      { method: "CASH", amount: rupeesToPaisa(formData.get("cash")) },
      { method: "QR", amount: rupeesToPaisa(formData.get("qr")) },
      { method: "CARD", amount: rupeesToPaisa(formData.get("card")) },
    ] as const
  ).filter((p) => p.amount > 0);
  // Keep the discount in the URL so an error does not silently reset the bill preview.
  const params = new URLSearchParams();
  if (pct > 0) params.set("discount", String(pct));
  const redeemBlocks = Number(formData.get("redeemBlocks") || 0);
  if (redeemBlocks > 0) params.set("redeem", String(redeemBlocks));
  const rewardId = String(formData.get("rewardId") || "").slice(0, 100) || undefined;
  if (rewardId) params.set("reward", rewardId);
  const freeItemId = String(formData.get("freeItemId") || "").slice(0, 100) || undefined;
  if (rewardId && freeItemId) params.set("free", freeItemId);
  const stampProgramId = String(formData.get("stampProgramId") || "").slice(0, 100) || undefined;
  const stampItemId = String(formData.get("stampItemId") || "").slice(0, 100) || undefined;
  if (stampProgramId) params.set("stamp", stampProgramId);
  if (stampProgramId && stampItemId) params.set("stampItem", stampItemId);
  const back = params.size ? `/orders/${orderId}?${params}` : `/orders/${orderId}`;
  const buyerName = String(formData.get("buyerName") || "").slice(0, 200);
  const buyerPan = String(formData.get("buyerPan") || "").slice(0, 30);
  await guarded(back, () => checkout(ctx, orderId, { discount, payments: [...payments], redeemPoints, rewardId, freeItemId, buyerName, buyerPan, stampProgramId, stampItemId }));
  revalidatePath("/orders", "layout");
  redirect(`/orders/${orderId}`);
}
