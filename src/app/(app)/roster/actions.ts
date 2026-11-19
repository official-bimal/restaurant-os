"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { addRosterShift, copyWeek, removeRosterShift } from "@/features/roster/server/service";

const id = z.string().min(1).max(60);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function back(week: string): never {
  revalidatePath("/roster");
  redirect(`/roster?week=${encodeURIComponent(week)}`);
}

export async function addShiftAction(week: string, formData: FormData) {
  const ctx = await requireTenant();
  const w = date.parse(week);
  await guarded(`/roster?week=${w}`, () =>
    addRosterShift(ctx, {
      userId: id.parse(String(formData.get("userId") ?? "")),
      date: String(formData.get("date") ?? ""),
      startTime: String(formData.get("start") ?? ""),
      endTime: String(formData.get("end") ?? ""),
      note: String(formData.get("note") ?? ""),
    }),
  );
  back(w);
}

export async function removeShiftAction(week: string, shiftId: string) {
  const ctx = await requireTenant();
  const w = date.parse(week);
  await guarded(`/roster?week=${w}`, () => removeRosterShift(ctx, id.parse(shiftId)));
  back(w);
}

export async function copyWeekAction(fromWeek: string, toWeek: string) {
  const ctx = await requireTenant();
  const to = date.parse(toWeek);
  await guarded(`/roster?week=${to}`, () => copyWeek(ctx, date.parse(fromWeek), to));
  back(to);
}
