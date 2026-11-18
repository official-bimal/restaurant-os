"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DomainError } from "@/server/errors";
import { allow } from "@/server/rate-limit";
import { cancelOnlineOrder, quoteDelivery, submitOnlineOrder } from "@/features/online/server/service";

export type PlaceResult = { ok: true; url: string } | { ok: false; error: string };
export type QuoteResult = { ok: true; fee: number; label: string } | { ok: false; error: string };

/** Nobody is signed in on this page, so the caller's address is the only thing to count requests by. */
async function caller(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

const TRY_AGAIN = "Something went wrong. Please try again.";
const SLOW_DOWN = "Too many tries. Please wait a few minutes and try again.";

const quoteSchema = z.object({
  address: z.string().max(300),
  phone: z.string().max(40).optional(),
  location: z.string().max(200).optional(),
  zoneId: z.string().max(60).optional(),
});

export async function quoteAction(token: string, input: unknown): Promise<QuoteResult> {
  const parsed = quoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: TRY_AGAIN };
  if (!allow(`online-quote:${await caller()}`, 40, 10 * 60_000)) return { ok: false, error: SLOW_DOWN };
  try {
    const q = await quoteDelivery(token, parsed.data);
    return { ok: true, fee: q.fee, label: q.label };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
}

const orderSchema = z.object({
  idempotencyKey: z.string().min(8).max(64),
  type: z.enum(["TAKEAWAY", "DELIVERY"]),
  name: z.string().max(120),
  phone: z.string().max(40),
  note: z.string().max(400).optional(),
  address: z.string().max(300).optional(),
  location: z.string().max(200).optional(),
  zoneId: z.string().max(60).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1).max(60),
        quantity: z.number().int().min(1).max(99),
        note: z.string().max(300).optional(),
        addOnIds: z.array(z.string().min(1).max(60)).max(30).optional(),
      }),
    )
    .max(100),
});

export async function placeOrderAction(token: string, input: unknown): Promise<PlaceResult> {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something is wrong with your order. Please check it and try again." };
  // A retry of the same order (same key) is always allowed through, so a bad connection never locks someone out of their own order.
  if (!allow(`online-order:${await caller()}`, 12, 60 * 60_000)) return { ok: false, error: SLOW_DOWN };
  try {
    const o = await submitOnlineOrder(token, parsed.data);
    return { ok: true, url: `/o/${token}/status/${o.trackingToken}` };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function cancelOrderAction(token: string, trackingToken: string) {
  let note = "Your order was cancelled.";
  try {
    await cancelOnlineOrder(token, trackingToken);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    note = e.message;
  }
  revalidatePath(`/o/${token}/status/${trackingToken}`);
  redirect(`/o/${token}/status/${trackingToken}?note=${encodeURIComponent(note)}`);
}
