"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { addDisplay, deleteDisplay, newLink, removePaymentQr, renameDisplay, saveSetting, setPaymentQr } from "@/features/display/server/service";

const BACK = "/settings/display";
const done = (note: string) => redirect(`${BACK}?note=${encodeURIComponent(note)}`);

export async function saveSettingAction(formData: FormData) {
  const ctx = await requireTenant("display.manage");
  await guarded(BACK, () =>
    saveSetting(ctx, {
      enabled: formData.get("enabled") === "on",
      welcomeTitle: String(formData.get("welcomeTitle") ?? ""),
      welcomeText: String(formData.get("welcomeText") ?? ""),
      thanksText: String(formData.get("thanksText") ?? ""),
      thanksSeconds: Number(formData.get("thanksSeconds") ?? 12),
      showNotes: formData.get("showNotes") === "on",
      showLogo: formData.get("showLogo") === "on",
      autoQr: formData.get("autoQr") === "on",
      qrLabel: String(formData.get("qrLabel") ?? ""),
    }),
  );
  revalidatePath(BACK);
  done("Saved.");
}

export async function uploadQrAction(formData: FormData) {
  const ctx = await requireTenant("display.manage");
  const file = formData.get("qr");
  await guarded(BACK, async () => setPaymentQr(ctx, file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array()));
  revalidatePath(BACK);
  done("Payment QR saved.");
}

export async function removeQrAction() {
  const ctx = await requireTenant("display.manage");
  await guarded(BACK, () => removePaymentQr(ctx));
  revalidatePath(BACK);
  done("Payment QR removed.");
}

export async function addDisplayAction(formData: FormData) {
  const ctx = await requireTenant("display.manage");
  await guarded(BACK, () => addDisplay(ctx, String(formData.get("name") ?? "")));
  revalidatePath(BACK);
  done("Screen added. Choose how to open it below.");
}

export async function renameDisplayAction(id: string, formData: FormData) {
  const ctx = await requireTenant("display.manage");
  await guarded(BACK, () => renameDisplay(ctx, id, String(formData.get("name") ?? "")));
  revalidatePath(BACK);
  done("Saved.");
}

export async function newLinkAction(id: string) {
  const ctx = await requireTenant("display.manage");
  await guarded(BACK, () => newLink(ctx, id));
  revalidatePath(BACK);
  done("New link made. The old one no longer works, so open the screen again with the new link.");
}

export async function deleteDisplayAction(id: string) {
  const ctx = await requireTenant("display.manage");
  await guarded(BACK, () => deleteDisplay(ctx, id));
  revalidatePath(BACK);
  done("Screen removed.");
}
