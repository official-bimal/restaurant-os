"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { savePaymentSetting } from "@/features/payments/server/service";

export async function savePaymentSettingAction(provider: string, formData: FormData) {
  const ctx = await requireTenant();
  await guarded("/settings/payments", () =>
    savePaymentSetting(ctx, provider, {
      enabled: formData.get("enabled") === "on",
      mode: String(formData.get("mode") ?? "TEST"),
      merchantCode: String(formData.get("merchantCode") ?? ""),
      secret: String(formData.get("secret") ?? ""),
    }),
  );
  revalidatePath("/settings/payments");
  redirect(`/settings/payments?saved=${encodeURIComponent(provider)}`);
}
