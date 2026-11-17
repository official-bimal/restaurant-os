"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { setItemStatus } from "@/features/orders/server/service";

export async function kitchenStatusAction(itemId: string, formData: FormData) {
  const ctx = await requireTenant("kitchen.update");
  const to = z.enum(["PREPARING", "READY", "PENDING"]).parse(formData.get("to"));
  try {
    await setItemStatus(ctx, itemId, to);
  } catch (e) {
    // Another device may have moved the item already; the refresh shows the truth.
    if (!(e instanceof DomainError)) throw e;
  }
  revalidatePath("/kitchen");
}
