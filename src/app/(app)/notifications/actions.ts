"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { markAllRead, markRead } from "@/features/notifications/server/service";

export async function markReadAction(key: string) {
  const ctx = await requireTenant();
  await markRead(ctx, [key]);
  revalidatePath("/", "layout");
  redirect("/notifications");
}

export async function markAllReadAction() {
  const ctx = await requireTenant();
  await markAllRead(ctx);
  revalidatePath("/", "layout");
  redirect("/notifications");
}
