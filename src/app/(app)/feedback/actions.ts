"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { resolveFeedback, setFeedbackSettings } from "@/features/feedback/server/service";

export async function setFeedbackSettingsAction(formData: FormData) {
  const ctx = await requireTenant("feedback.view");
  const url = z.string().max(600).parse(formData.get("googleReviewUrl") ?? "");
  await guarded("/feedback", () =>
    setFeedbackSettings(ctx, { enabled: formData.get("enabled") === "on", googleReviewUrl: url }),
  );
  revalidatePath("/feedback");
  redirect("/feedback");
}

export async function resolveFeedbackAction(id: string, formData: FormData) {
  const ctx = await requireTenant("feedback.view");
  const note = z.string().max(400).parse(formData.get("note") ?? "");
  await guarded("/feedback", () => resolveFeedback(ctx, id, note));
  revalidatePath("/feedback", "layout");
  redirect("/feedback");
}
