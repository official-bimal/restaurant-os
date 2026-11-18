"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { acceptOnlineOrder, rejectOnlineOrder, rotateOnlineLink, saveOnlineSettings } from "@/features/online/server/service";

const BACK = "/online";
const done = (note: string) => redirect(`${BACK}?note=${encodeURIComponent(note)}`);

export async function acceptAction(id: string) {
  const ctx = await requireTenant("order.edit");
  const r = await guarded(BACK, () => acceptOnlineOrder(ctx, id));
  revalidatePath("/", "layout");
  done(`Accepted. It is order #${r.number} now: find it under Orders.`);
}

export async function rejectAction(id: string, formData: FormData) {
  const ctx = await requireTenant("order.edit");
  await guarded(BACK, () => rejectOnlineOrder(ctx, id, String(formData.get("reason") ?? "")));
  revalidatePath("/", "layout");
  done("Rejected. The customer can see why.");
}

export async function saveSettingsAction(formData: FormData) {
  const ctx = await requireTenant("branch.manage");
  const rupees = Number(String(formData.get("minOrder") ?? "0").trim() || 0);
  await guarded(BACK, () =>
    saveOnlineSettings(ctx, {
      enabled: formData.get("enabled") === "on",
      pickup: formData.get("pickup") === "on",
      delivery: formData.get("delivery") === "on",
      minOrder: Math.round(rupees * 100),
      prepMinutes: Math.round(Number(formData.get("prepMinutes") ?? 0)),
      notice: String(formData.get("notice") ?? ""),
    }),
  );
  revalidatePath(BACK);
  done("Saved.");
}

export async function rotateLinkAction() {
  const ctx = await requireTenant("branch.manage");
  await guarded(BACK, () => rotateOnlineLink(ctx));
  revalidatePath(BACK);
  done("New link made. The old link and any printed QR code no longer work.");
}
