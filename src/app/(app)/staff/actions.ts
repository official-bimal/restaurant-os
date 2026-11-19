"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { guarded } from "@/server/guarded";
import {
  changeRole,
  createStaff,
  removeStaff,
  resetStaffPassword,
} from "@/features/staff/server/service";

const BACK = "/staff";
const roleSchema = z.enum(["OWNER", "MANAGER", "CASHIER", "WAITER", "KITCHEN", "RIDER", "ACCOUNTANT"]);

/**
 * State returned to the form. The temporary password only ever travels in this
 * response to the person who asked (never in a URL), and is not stored anywhere readable.
 */
export interface SecretState {
  error?: string;
  email?: string;
  tempPassword?: string;
}

export async function createStaffAction(_prev: SecretState, formData: FormData): Promise<SecretState> {
  const ctx = await requireTenant("staff.manage");
  const parsed = z
    .object({ name: z.string().max(200), email: z.string().max(300), role: roleSchema })
    .safeParse({ name: formData.get("name") ?? "", email: formData.get("email") ?? "", role: formData.get("role") });
  if (!parsed.success) return { error: "Fill in name, email and role." };
  try {
    const created = await createStaff(ctx, parsed.data);
    revalidatePath(BACK);
    return { email: created.email, tempPassword: created.tempPassword };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function resetPasswordAction(membershipId: string): Promise<SecretState> {
  const ctx = await requireTenant("staff.manage");
  try {
    const r = await resetStaffPassword(ctx, membershipId);
    revalidatePath(BACK);
    return { email: r.email, tempPassword: r.tempPassword };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function changeRoleAction(membershipId: string, formData: FormData) {
  const ctx = await requireTenant("staff.manage");
  const role = roleSchema.parse(formData.get("role"));
  await guarded(BACK, () => changeRole(ctx, membershipId, role));
  revalidatePath(BACK);
  redirect(BACK);
}

export async function removeStaffAction(membershipId: string) {
  const ctx = await requireTenant("staff.manage");
  await guarded(BACK, () => removeStaff(ctx, membershipId));
  revalidatePath(BACK);
  redirect(BACK);
}
