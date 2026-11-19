"use server";

import { cookiesSecure } from "@/server/cookie-security";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DomainError } from "@/server/errors";
import { createGuestToken, GUEST_COOKIE, GUEST_MAX_AGE_SECONDS, verifyGuestToken } from "@/server/session";
import { submitComment, submitDishRating, submitRating } from "@/features/feedback/server/service";
import { attachGuestCustomer, openSession, requestService, resolveGuest, submitOrder } from "@/features/guest/server/service";

export interface GuestResult {
  ok?: boolean;
  error?: string;
}

/** The guest's current sitting from their cookie, re-checked against the database. */
async function currentGuest() {
  const store = await cookies();
  const g = await resolveGuest(verifyGuestToken(store.get(GUEST_COOKIE)?.value));
  if (!g) throw new DomainError("This table's session has ended. Scan the QR code again to start a new order.");
  return g.ctx;
}

/** Opens (or joins) the table's sitting and remembers it on the guest's phone. Only ever called from a tap, never from a link preview. */
async function beginSitting(token: string) {
  const gc = await openSession(token);
  const store = await cookies();
  store.set(GUEST_COOKIE, createGuestToken({ sessionId: gc.sessionId, tableId: gc.tableId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookiesSecure(),
    path: "/",
    maxAge: GUEST_MAX_AGE_SECONDS,
  });
  return gc;
}

/** Tapping "Order food" opens (or joins) the table's sitting. A link preview never does. */
export async function startOrderingAction(token: string) {
  let target = `/t/${token}`;
  try {
    await beginSitting(token);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    target = `/t/${token}?error=${encodeURIComponent(e.message)}`;
  }
  redirect(target);
}

const orderSchema = z.object({
  idempotencyKey: z.string().min(8).max(64),
  note: z.string().max(300).optional(),
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

export async function submitOrderAction(token: string, input: unknown): Promise<GuestResult> {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { error: "Something is wrong with your order. Please try again." };
  try {
    const gc = await currentGuest();
    await submitOrder(gc, parsed.data);
    revalidatePath(`/t/${token}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function requestServiceAction(token: string, kind: "CALL_WAITER" | "REQUEST_BILL" | "WATER"): Promise<GuestResult> {
  if (!["CALL_WAITER", "REQUEST_BILL", "WATER"].includes(kind)) return { error: "Unknown request." };
  try {
    const gc = await currentGuest();
    await requestService(gc, kind);
    revalidatePath(`/t/${token}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

const phoneSchema = z.object({
  phone: z.string().min(1).max(40),
  name: z.string().max(80).optional(),
  marketingConsent: z.boolean().optional(),
});

/**
 * "Join our rewards" straight from the first screen: opens the sitting, says whose points this visit earns, and goes on to the
 * menu. Always answers the same way whether or not the number is already a customer.
 */
export async function joinRewardsAction(token: string, input: unknown): Promise<GuestResult> {
  const parsed = phoneSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter a valid phone number." };
  try {
    const gc = await beginSitting(token);
    await attachGuestCustomer(gc, parsed.data);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/t/${token}`);
  redirect(`/t/${token}`);
}

export async function attachNumberAction(token: string, input: unknown): Promise<GuestResult & { maskedPhone?: string }> {
  const parsed = phoneSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter a valid phone number." };
  try {
    const gc = await currentGuest();
    const { maskedPhone } = await attachGuestCustomer(gc, parsed.data);
    revalidatePath(`/t/${token}`);
    return { ok: true, maskedPhone };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

/** Feedback comes from a sitting that has already ended, so it is checked against the cookie directly. */
async function cookieClaims() {
  const store = await cookies();
  return verifyGuestToken(store.get(GUEST_COOKIE)?.value);
}

export async function rateAction(token: string, rating: number): Promise<GuestResult> {
  try {
    await submitRating(await cookieClaims(), rating);
    revalidatePath(`/t/${token}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function commentAction(token: string, comment: string): Promise<GuestResult> {
  if (typeof comment !== "string") return { error: "Something went wrong. Please try again." };
  try {
    await submitComment(await cookieClaims(), comment);
    revalidatePath(`/t/${token}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function rateDishAction(token: string, menuItemId: string, rating: number): Promise<GuestResult> {
  if (typeof menuItemId !== "string" || menuItemId.length > 60) return { error: "Something went wrong. Please try again." };
  try {
    await submitDishRating(await cookieClaims(), menuItemId, rating);
    revalidatePath(`/t/${token}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}
