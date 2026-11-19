"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { setMultiBranch } from "@/features/branches/server/service";

export async function multiBranchAction(on: boolean) {
  const ctx = await requireTenant("branch.manage");
  await guarded("/settings", () => setMultiBranch(ctx, on));
  revalidatePath("/", "layout");
  redirect("/settings");
}
