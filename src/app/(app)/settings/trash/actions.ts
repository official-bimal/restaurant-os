"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { emptyTrashItem, restoreFromTrash } from "@/features/business/server/trash";

export async function restoreAction(id: string) {
  const ctx = await requireTenant("menu.manage");
  await guarded("/settings/trash", () => restoreFromTrash(ctx, id));
  revalidatePath("/menu");
  redirect("/settings/trash?restored=1");
}

export async function purgeAction(id: string) {
  const ctx = await requireTenant("menu.manage");
  await guarded("/settings/trash", () => emptyTrashItem(ctx, id));
  redirect("/settings/trash");
}
