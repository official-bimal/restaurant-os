"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { addAdjustment, finalizePayroll, markLinePaid, removeAdjustment, setPayTerms } from "@/features/payroll/server/payroll";

const rupeesToPaisa = (v: FormDataEntryValue | null) => Math.round(Number(v || 0) * 100);
const to = (period: string) => `/payroll?period=${encodeURIComponent(period)}`;
const period = (f: FormData) => String(f.get("period") ?? "");

export async function setTermsAction(userId: string, formData: FormData) {
  const ctx = await requireTenant("payroll.manage");
  const back = to(period(formData));
  await guarded(back, () =>
    setPayTerms(ctx, userId, {
      payType: String(formData.get("payType") ?? "NONE"),
      payRate: rupeesToPaisa(formData.get("payRate")),
      overtimeBps: Math.round(Number(formData.get("overtimeTimes") || 1.5) * 10_000),
      overtimeAfterMinutes: Math.round(Number(formData.get("overtimeAfterHours") || 8) * 60),
    }),
  );
  revalidatePath("/payroll");
  redirect(back);
}

export async function addAdjustmentAction(formData: FormData) {
  const ctx = await requireTenant("payroll.manage");
  const back = to(period(formData));
  await guarded(back, () =>
    addAdjustment(ctx, {
      userId: String(formData.get("userId") ?? ""),
      period: period(formData),
      kind: String(formData.get("kind") ?? ""),
      amount: rupeesToPaisa(formData.get("amount")),
      note: String(formData.get("note") ?? ""),
    }),
  );
  revalidatePath("/payroll");
  redirect(back);
}

export async function removeAdjustmentAction(id: string, formData: FormData) {
  const ctx = await requireTenant("payroll.manage");
  const back = to(period(formData));
  await guarded(back, () => removeAdjustment(ctx, id));
  revalidatePath("/payroll");
  redirect(back);
}

export async function finalizeAction(formData: FormData) {
  const ctx = await requireTenant("payroll.manage");
  const back = to(period(formData));
  await guarded(back, () => finalizePayroll(ctx, period(formData), String(formData.get("note") ?? "")));
  revalidatePath("/payroll");
  redirect(back);
}

export async function markPaidAction(lineId: string, formData: FormData) {
  const ctx = await requireTenant("payroll.manage");
  const back = to(period(formData));
  await guarded(back, () => markLinePaid(ctx, lineId, String(formData.get("method") ?? "")));
  revalidatePath("/payroll");
  redirect(back);
}
