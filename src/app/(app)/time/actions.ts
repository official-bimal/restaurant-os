"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { guarded } from "@/server/guarded";
import { parseLocalDateTime } from "@/features/payroll/payroll";
import { addManualEntry, clockIn, clockOut, editEntry, removeEntry, setClockSettings } from "@/features/payroll/server/time";

const BACK = "/time";

async function tz(businessId: string) {
  return (await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } })).timezone;
}
function when(value: FormDataEntryValue | null, zone: string, required: true): Date;
function when(value: FormDataEntryValue | null, zone: string, required: false): Date | null;
function when(value: FormDataEntryValue | null, zone: string, required: boolean): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw && !required) return null;
  const d = parseLocalDateTime(raw, zone);
  if (!d) throw new DomainError("Enter a valid date and time.");
  return d;
}

/** Used by the clock button in the menu, from any page. Answers with an error message so the button can show it in place. */
export async function clockInAction(location: unknown): Promise<{ error?: string }> {
  const ctx = await requireTenant();
  try {
    await clockIn(ctx, location);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  return {};
}

export async function clockOutAction(location: unknown): Promise<{ error?: string }> {
  const ctx = await requireTenant();
  try {
    await clockOut(ctx, location);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  return {};
}

export async function saveClockSettingsAction(formData: FormData) {
  const ctx = await requireTenant("time.manage");
  await guarded(BACK, () => setClockSettings(ctx, { requireLocation: formData.get("requireLocation") === "on", radius: Number(formData.get("radius") || 150) }));
  revalidatePath("/", "layout");
  redirect(BACK);
}

export async function addEntryAction(formData: FormData) {
  const ctx = await requireTenant("time.manage");
  const zone = await tz(ctx.businessId);
  await guarded(BACK, async () =>
    addManualEntry(ctx, {
      userId: String(formData.get("userId") ?? ""),
      clockIn: when(formData.get("clockIn"), zone, true),
      clockOut: when(formData.get("clockOut"), zone, true),
      note: String(formData.get("note") ?? ""),
    }),
  );
  revalidatePath(BACK);
  redirect(`${BACK}?user=${encodeURIComponent(String(formData.get("userId") ?? ""))}&period=${encodeURIComponent(String(formData.get("period") ?? ""))}`);
}

export async function editEntryAction(id: string, formData: FormData) {
  const ctx = await requireTenant("time.manage");
  const zone = await tz(ctx.businessId);
  const back = `${BACK}?user=${encodeURIComponent(String(formData.get("user") ?? ""))}&period=${encodeURIComponent(String(formData.get("period") ?? ""))}`;
  await guarded(back, async () =>
    editEntry(ctx, id, { clockIn: when(formData.get("clockIn"), zone, true), clockOut: when(formData.get("clockOut"), zone, false), note: String(formData.get("note") ?? "") }),
  );
  revalidatePath(BACK);
  redirect(back);
}

export async function removeEntryAction(id: string, formData: FormData) {
  const ctx = await requireTenant("time.manage");
  const back = `${BACK}?user=${encodeURIComponent(String(formData.get("user") ?? ""))}&period=${encodeURIComponent(String(formData.get("period") ?? ""))}`;
  await guarded(back, () => removeEntry(ctx, id, String(formData.get("reason") ?? "")));
  revalidatePath(BACK);
  redirect(back);
}
