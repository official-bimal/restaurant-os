"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { disconnect, saveLink, setSending } from "@/features/customeros/server/link";
import { flushBusiness, retryFailed } from "@/features/customeros/server/outbox";

const BACK = "/customer-os";
const done = (note: string) => redirect(`${BACK}?note=${encodeURIComponent(note)}`);

export async function connectAction(formData: FormData) {
  const ctx = await requireTenant("owner.control");
  const r = await guarded(BACK, () => saveLink(ctx, { baseUrl: String(formData.get("baseUrl") ?? ""), key: String(formData.get("key") ?? "") }));
  revalidatePath(BACK);
  done(`Connected to ${r.business}. New paid bills with a customer now go there, and Customer OS gives the points.`);
}

export async function sendNowAction() {
  const ctx = await requireTenant("owner.control");
  const r = await guarded(BACK, () => flushBusiness(ctx.businessId));
  revalidatePath(BACK);
  done(`Sent ${r.sent}. Waiting to try again: ${r.waiting}. Failed: ${r.failed}.`);
}

export async function retryFailedAction() {
  const ctx = await requireTenant("owner.control");
  const n = await guarded(BACK, () => retryFailed(ctx));
  const r = await guarded(BACK, () => flushBusiness(ctx.businessId));
  revalidatePath(BACK);
  done(`${n} bill${n === 1 ? "" : "s"} queued again. Sent ${r.sent} now.`);
}

export async function pauseAction(enabled: boolean) {
  const ctx = await requireTenant("owner.control");
  await guarded(BACK, () => setSending(ctx, enabled));
  revalidatePath(BACK);
  done(enabled ? "Sending resumed." : "Sending paused. Paid bills are kept and sent when you resume.");
}

export async function disconnectAction() {
  const ctx = await requireTenant("owner.control");
  await guarded(BACK, () => disconnect(ctx));
  revalidatePath(BACK);
  done("Disconnected. The saved key was removed. Points are not given anywhere until you turn this app's own points on again or reconnect.");
}
