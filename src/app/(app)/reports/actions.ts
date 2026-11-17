"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { closeDay, reopenDay } from "@/features/reports/server/service";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function closeDayAction(date: string, formData: FormData) {
  const ctx = await requireTenant("day.close");
  const d = dateSchema.parse(date);
  const counted = Number(formData.get("counted"));
  const note = z.string().max(300).parse(formData.get("note") ?? "");
  if (!Number.isFinite(counted)) redirect(`/reports?date=${d}&error=${encodeURIComponent("Enter the cash you counted.")}`);
  await guarded(`/reports?date=${d}`, () => closeDay(ctx, { date: d, countedCash: Math.round(counted * 100), note }));
  revalidatePath("/reports");
  redirect(`/reports?date=${d}`);
}

export async function reopenDayAction(date: string) {
  const ctx = await requireTenant("day.reopen");
  const d = dateSchema.parse(date);
  await guarded(`/reports?date=${d}`, () => reopenDay(ctx, d));
  revalidatePath("/reports");
  redirect(`/reports?date=${d}`);
}
