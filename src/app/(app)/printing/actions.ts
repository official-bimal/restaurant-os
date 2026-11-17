"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { guarded } from "@/server/guarded";
import { createAgentKey, savePrintConfig } from "@/features/printing/server/settings";
import { cancelJob, queueDocument, retryJob } from "@/features/printing/server/queue";
import { isDocKind } from "@/features/printing/server/render";

const BACK = "/printing";
const num = (v: FormDataEntryValue | null) => Number(String(v ?? "").trim());

export async function savePrintSettingsAction(formData: FormData) {
  const ctx = await requireTenant("print.manage");
  const height = String(formData.get("paperHeightMm") ?? "").trim();
  await guarded(BACK, () =>
    savePrintConfig(ctx, {
      paperWidthMm: num(formData.get("paperWidthMm")),
      paperHeightMm: height === "" ? null : Number(height),
      marginMm: num(formData.get("marginMm")),
      fontSizeTenthPt: Math.round(num(formData.get("fontPt")) * 10),
      headerLine: String(formData.get("headerLine") ?? ""),
      footerLine: String(formData.get("footerLine") ?? ""),
      showPan: formData.get("showPan") === "on",
      showAddress: formData.get("showAddress") === "on",
      showCustomer: formData.get("showCustomer") === "on",
      kitchenLargeText: formData.get("kitchenLargeText") === "on",
      autoKitchenPrint: formData.get("autoKitchenPrint") === "on",
      receiptCopies: Math.round(num(formData.get("receiptCopies")) || 1),
    }),
  );
  revalidatePath(BACK);
  redirect(`${BACK}?note=${encodeURIComponent("Saved.")}`);
}

/** Makes a new printer key and shows it once. */
export async function createAgentKeyAction(): Promise<{ key?: string; error?: string }> {
  const ctx = await requireTenant("print.manage");
  try {
    return { key: await createAgentKey(ctx) };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

/** "Send to printer queue" from an order page. */
export async function queuePrintAction(kind: string, id: string, orderId: string) {
  const ctx = await requireTenant();
  const back = `/orders/${orderId}`;
  if (!isDocKind(kind)) redirect(back);
  await guarded(back, () => queueDocument(ctx, kind, id));
  revalidatePath(BACK);
  redirect(`${back}?printed=1`);
}

export async function cancelJobAction(id: string) {
  const ctx = await requireTenant("print.manage");
  await guarded(BACK, () => cancelJob(ctx, id));
  revalidatePath(BACK);
  redirect(BACK);
}

export async function retryJobAction(id: string) {
  const ctx = await requireTenant("print.manage");
  await guarded(BACK, () => retryJob(ctx, id));
  revalidatePath(BACK);
  redirect(BACK);
}
