"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { markAlertsSeen, saveOwnerSettings, sendSummaryNow } from "@/features/owner/server/owner";
import { closeBlock } from "@/features/offline/server/blocks";

const BACK = "/owner";
const num = (v: FormDataEntryValue | null) => Number(String(v ?? "").trim() || 0);
const paisa = (v: FormDataEntryValue | null) => Math.round(num(v) * 100);

export async function saveOwnerSettingsAction(formData: FormData) {
  const ctx = await requireTenant("owner.control");
  await guarded(BACK, () =>
    saveOwnerSettings(ctx, {
      summaryEnabled: formData.get("summaryEnabled") === "on",
      summaryHour: Math.round(num(formData.get("summaryHour"))),
      channelPush: formData.get("channelPush") === "on",
      smsPhone: String(formData.get("smsPhone") ?? ""),
      email: String(formData.get("email") ?? ""),
      alertsEnabled: formData.get("alertsEnabled") === "on",
      alertVoidCount: Math.round(num(formData.get("alertVoidCount"))),
      alertVoidAmount: paisa(formData.get("alertVoidAmount")),
      alertDiscountPct: Math.round(num(formData.get("alertDiscountPct"))),
      alertDiscountSharePct: num(formData.get("alertDiscountSharePct")),
      alertRefundAmount: paisa(formData.get("alertRefundAmount")),
      alertCashDiff: paisa(formData.get("alertCashDiff")),
    }),
  );
  revalidatePath(BACK);
  redirect(`${BACK}?note=${encodeURIComponent("Saved.")}`);
}

export async function markSeenAction() {
  const ctx = await requireTenant("owner.control");
  await guarded(BACK, () => markAlertsSeen(ctx));
  revalidatePath("/", "layout");
  redirect(BACK);
}

/** Sends today's summary to the channels that are switched on, right now. The owner pressed the button. */
export async function sendSummaryNowAction() {
  const ctx = await requireTenant("owner.control");
  const report = await guarded(BACK, () => sendSummaryNow(ctx));
  const note = `Sent. Push: ${report.push}. Text message: ${report.sms}. Email: ${report.email}.`;
  redirect(`${BACK}?note=${encodeURIComponent(note)}`);
}

/** Close a phone's block of invoice numbers: every number it never used is recorded as a gap, with the reason. */
export async function closeBlockAction(blockId: string, formData: FormData) {
  const ctx = await requireTenant("owner.control");
  await guarded(BACK, () => closeBlock(ctx, blockId, String(formData.get("reason") ?? "")));
  revalidatePath(BACK);
  redirect(`${BACK}?note=${encodeURIComponent("Block closed. Its unused numbers are listed as gaps.")}`);
}
