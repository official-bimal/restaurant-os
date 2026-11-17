"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import {
  adjustPoints,
  deleteCustomer,
  setLoyaltySettings,
  updateCustomer,
} from "@/features/loyalty/server/customers";
import { setBirthday } from "@/features/campaigns/server/automation";

export async function setLoyaltySettingsAction(formData: FormData) {
  const ctx = await requireTenant("customer.manage");
  const n = (k: string) => Number(formData.get(k) ?? 0);
  const input = {
    enabled: formData.get("enabled") === "on",
    pointsPer100: Math.round(n("pointsPer100")),
    redeemPoints: Math.round(n("redeemPoints")),
    redeemValue: Math.round(n("redeemValueRupees") * 100),
  };
  await guarded("/customers", () => setLoyaltySettings(ctx, input));
  revalidatePath("/customers");
  redirect("/customers");
}

export async function updateCustomerAction(id: string, formData: FormData) {
  const ctx = await requireTenant("customer.manage");
  const back = `/customers/${id}`;
  const name = z.string().max(200).parse(formData.get("name") ?? "");
  await guarded(back, () => updateCustomer(ctx, id, { name, marketingConsent: formData.get("consent") === "on" }));
  revalidatePath(back);
  redirect(back);
}

export async function adjustPointsAction(id: string, formData: FormData) {
  const ctx = await requireTenant("customer.manage");
  const back = `/customers/${id}`;
  const points = Math.trunc(Number(formData.get("points") ?? 0));
  const reason = z.string().max(200).parse(formData.get("reason") ?? "");
  await guarded(back, () => adjustPoints(ctx, id, { points, reason }));
  revalidatePath(back);
  redirect(back);
}

export async function deleteCustomerAction(id: string) {
  const ctx = await requireTenant("customer.manage");
  await guarded(`/customers/${id}`, () => deleteCustomer(ctx, id));
  revalidatePath("/customers");
  redirect("/customers");
}

/** Month and day only (no year). Leave both empty to clear it. */
export async function setBirthdayAction(id: string, formData: FormData) {
  const ctx = await requireTenant("customer.manage");
  const back = `/customers/${id}`;
  const m = String(formData.get("month") ?? "").trim();
  const d = String(formData.get("day") ?? "").trim();
  const month = m === "" ? null : Number(m);
  const day = d === "" ? null : Number(d);
  await guarded(back, () => setBirthday(ctx, id, month, day));
  revalidatePath(back);
  redirect(back);
}
