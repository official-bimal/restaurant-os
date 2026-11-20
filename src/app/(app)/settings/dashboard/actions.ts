"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { guarded } from "@/server/guarded";
import { resetLayout, saveLayout, saveTemplate, setWidgetVisibility } from "@/features/dashboard/server/preferences";

/** Called by the editor with the whole layout as JSON. Returns an error message instead of redirecting, so the editor stays open. */
export async function saveLayoutAction(json: string): Promise<{ error?: string }> {
  const ctx = await requireTenant();
  if (json.length > 50_000) return { error: "That layout is too large." };
  try {
    await saveLayout(ctx, JSON.parse(json));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    if (e instanceof SyntaxError) return { error: "That layout could not be read." };
    throw e;
  }
  revalidatePath("/dashboard");
  return {};
}

export async function applyTemplateAction(template: string) {
  const ctx = await requireTenant();
  await guarded("/settings/dashboard/templates", () => saveTemplate(ctx, template));
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function resetDashboardAction() {
  const ctx = await requireTenant();
  await resetLayout(ctx);
  revalidatePath("/dashboard");
  redirect("/settings/dashboard?reset=1");
}

export async function saveVisibilityAction(formData: FormData) {
  const ctx = await requireTenant();
  await guarded("/settings/dashboard", () => setWidgetVisibility(ctx, formData.getAll("widget").map(String)));
  revalidatePath("/dashboard");
  redirect("/settings/dashboard?saved=1");
}
