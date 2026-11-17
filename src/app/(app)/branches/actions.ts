"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { BRANCH_COOKIE } from "@/server/session";
import { createBranch, setBranchActive, setBranchLocation, setStaffBranches, updateBranch } from "@/features/branches/server/service";

const BACK = "/branches";

export async function createBranchAction(formData: FormData) {
  const ctx = await requireTenant("branch.manage");
  await guarded(BACK, () =>
    createBranch(ctx, { name: String(formData.get("name") ?? ""), address: String(formData.get("address") ?? "") }),
  );
  revalidatePath("/", "layout");
  redirect(BACK);
}

export async function updateBranchAction(id: string, formData: FormData) {
  const ctx = await requireTenant("branch.manage");
  await guarded(BACK, () =>
    updateBranch(ctx, id, { name: String(formData.get("name") ?? ""), address: String(formData.get("address") ?? "") }),
  );
  revalidatePath("/", "layout");
  redirect(BACK);
}

export async function setBranchLocationAction(id: string, formData: FormData) {
  const ctx = await requireTenant("branch.manage");
  await guarded(BACK, () => setBranchLocation(ctx, id, String(formData.get("location") ?? "")));
  revalidatePath("/", "layout");
  redirect(BACK);
}

export async function setBranchActiveAction(id: string, active: boolean) {
  const ctx = await requireTenant("branch.manage");
  await guarded(BACK, () => setBranchActive(ctx, id, active));
  revalidatePath("/", "layout");
  redirect(BACK);
}

export async function setStaffBranchesAction(membershipId: string, formData: FormData) {
  const ctx = await requireTenant("branch.manage");
  const allBranches = formData.get("all") === "on";
  const branchIds = formData.getAll("branch").map(String);
  await guarded("/staff", () => setStaffBranches(ctx, membershipId, { allBranches, branchIds }));
  revalidatePath("/staff");
  redirect("/staff");
}

/** The header switcher. Only a branch this person may work in is accepted; anything else is ignored. */
export async function switchBranchAction(formData: FormData) {
  const ctx = await requireTenant();
  const id = String(formData.get("branch") ?? "");
  if (ctx.branchIds.includes(id)) {
    (await cookies()).set(BRANCH_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  revalidatePath("/", "layout");
  redirect("/orders");
}
