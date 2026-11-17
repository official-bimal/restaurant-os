"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { setBranchAddOn, setBranchMenuItem, setCategoryHiddenHere } from "@/features/menu/server/branch-menu";

const BACK = "/menu/branch";

function paisa(raw: FormDataEntryValue | null): number | null {
  const t = String(raw ?? "").trim();
  if (t === "") return null;
  const n = Math.round(Number(t) * 100);
  return Number.isNaN(n) ? -1 : n; // -1 is refused with a clear message
}

/** One dish's branch settings: a blank price follows the shared price; unticking "Offered here" hides it in this branch only; a station sends it to another kitchen station. */
export async function saveBranchItemAction(menuItemId: string, formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  const station = String(formData.get("stationId") ?? "");
  await guarded(BACK, () =>
    setBranchMenuItem(ctx, menuItemId, { price: paisa(formData.get("price")), available: formData.get("available") === "on", stationId: station || null }),
  );
  revalidatePath("/", "layout");
  redirect(BACK);
}

export async function setCategoryHiddenAction(categoryId: string, hidden: boolean) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => setCategoryHiddenHere(ctx, categoryId, hidden));
  revalidatePath("/", "layout");
  redirect(BACK);
}

export async function saveBranchAddOnAction(addOnId: string, formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => setBranchAddOn(ctx, addOnId, { price: paisa(formData.get("price")), available: formData.get("available") === "on" }));
  revalidatePath("/", "layout");
  redirect(BACK);
}
