"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { DomainError } from "@/server/errors";
import { createPayout, recordTip } from "@/features/roster/server/service";

function paisa(raw: FormDataEntryValue | null): number {
  const t = String(raw ?? "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new DomainError("Enter the amount as a number, like 150 or 150.50.");
  return Math.round(Number(t) * 100);
}

export async function recordTipAction(formData: FormData) {
  const ctx = await requireTenant();
  await guarded("/tips", () => recordTip(ctx, { date: String(formData.get("date") ?? ""), amount: paisa(formData.get("amount")), method: String(formData.get("method") ?? ""), note: String(formData.get("note") ?? "") }));
  revalidatePath("/tips");
  redirect("/tips");
}

export async function sharePayoutAction(formData: FormData) {
  const ctx = await requireTenant();
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  const basis = String(formData.get("basis") ?? "HOURS");
  const service = Number(String(formData.get("servicePercent") ?? "0")) || 0;
  const back = `/tips?from=${from}&to=${to}&basis=${basis}&service=${service}`;
  await guarded(back, () => createPayout(ctx, { from, to, basis, servicePercent: service }));
  revalidatePath("/tips");
  redirect(`/tips?shared=1`);
}
