"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { setItemStatus } from "@/features/orders/server/service";

/** Moves a ticket on from the big screen, then comes back to the same screen (same station filter). */
export async function screenStatusAction(itemId: string, back: string, formData: FormData) {
  const ctx = await requireTenant("kitchen.update");
  const to = z.enum(["PREPARING", "READY"]).parse(formData.get("to"));
  try {
    await setItemStatus(ctx, itemId, to);
  } catch (e) {
    // Another device may have moved the item already; the refresh shows the truth.
    if (!(e instanceof DomainError)) throw e;
  }
  redirect(back.startsWith("/screen/kitchen") ? back : "/screen/kitchen");
}
