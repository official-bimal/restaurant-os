"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { assignRole, deleteRole, saveRole } from "@/features/staff/server/roles";

export async function saveRoleAction(id: string | null, formData: FormData) {
  const ctx = await requireTenant("owner.control");
  await guarded("/staff/roles", () =>
    saveRole(ctx, id, {
      name: String(formData.get("name") ?? ""),
      color: String(formData.get("color") ?? ""),
      baseRole: String(formData.get("baseRole") ?? ""),
      permissions: formData.getAll("perm").map(String),
    }),
  );
  revalidatePath("/", "layout");
  redirect("/staff/roles?saved=1");
}

export async function deleteRoleAction(id: string) {
  const ctx = await requireTenant("owner.control");
  await guarded("/staff/roles", () => deleteRole(ctx, id));
  revalidatePath("/", "layout");
  redirect("/staff/roles");
}

export async function assignRoleAction(membershipId: string, formData: FormData) {
  const ctx = await requireTenant("owner.control");
  const v = String(formData.get("customRole") ?? "");
  await guarded("/staff", () => assignRole(ctx, membershipId, v || null));
  revalidatePath("/staff");
  redirect("/staff");
}
