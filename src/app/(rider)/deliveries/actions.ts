"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { reportLocationAsUser, riderUpdateAsUser } from "@/features/delivery/server/service";

const BACK = "/deliveries";

/** The rider's buttons on their own page. The order must be assigned to them; the service checks it. */
export async function riderStepAction(orderId: string, formData: FormData) {
  const ctx = await requireTenant("delivery.ride");
  const action = z.enum(["PICKED_UP", "DELIVERED", "FAILED"]).parse(formData.get("action"));
  let target = BACK;
  try {
    await riderUpdateAsUser(ctx, orderId, action);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    target = `${BACK}?error=${encodeURIComponent(e.message)}`;
  }
  revalidatePath(BACK);
  redirect(target);
}

export async function shareLocationAction(orderId: string, lat: number, lng: number): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireTenant("delivery.ride");
  try {
    await reportLocationAsUser(ctx, orderId, Number(lat), Number(lng));
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
}
