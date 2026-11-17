"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { cancelTransfer, receiveTransfer, transferStock } from "@/features/stock/server/transfers";

const BACK = "/stock/branches";

export async function transferAction(formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const input = z
    .object({
      toBranchId: z.string().min(1).max(80),
      stockItemId: z.string().min(1).max(80),
      quantity: z.coerce.number().int(),
      note: z.string().max(300).optional(),
      arrivesNow: z.boolean(),
    })
    .parse({
      toBranchId: formData.get("toBranchId"),
      stockItemId: formData.get("stockItemId"),
      quantity: formData.get("quantity"),
      note: formData.get("note") || undefined,
      arrivesNow: formData.get("arrivesNow") === "on",
    });
  await guarded(BACK, () => transferStock(ctx, input));
  revalidatePath("/stock", "layout");
  redirect(BACK);
}

/** Book in what arrived. Leave the count blank when everything came. */
export async function receiveAction(id: string, formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const raw = String(formData.get("received") ?? "").trim();
  const received = raw === "" ? undefined : Number(raw);
  await guarded(BACK, () => receiveTransfer(ctx, id, received));
  revalidatePath("/", "layout");
  redirect(BACK);
}

export async function cancelTransferAction(id: string, formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  await guarded(BACK, () => cancelTransfer(ctx, id, String(formData.get("reason") ?? "")));
  revalidatePath("/", "layout");
  redirect(BACK);
}
