"use server";

import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { removePushSubscription, savePushSubscription } from "@/features/notifications/server/push";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

export interface PushResult {
  ok: boolean;
  error?: string;
}

/** Turn background alerts on for this browser. The subscription belongs to the signed-in person. */
export async function subscribePushAction(input: unknown): Promise<PushResult> {
  const ctx = await requireTenant();
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That alert subscription is not valid." };
  try {
    await savePushSubscription(ctx, { endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth });
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function unsubscribePushAction(endpoint: string): Promise<PushResult> {
  const ctx = await requireTenant();
  await removePushSubscription(ctx, String(endpoint).slice(0, 1000));
  return { ok: true };
}
