"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { saveAppearance, saveBusinessAccent } from "@/features/dashboard/server/preferences";
import { removeLogo, setLogo } from "@/features/business/server/profile";

const BACK = "/settings/appearance";

/** Personal: light/dark/system and the accent colour (empty accent means use the business colour). */
export async function saveAppearanceAction(formData: FormData) {
  const ctx = await requireTenant();
  const accent = String(formData.get("accent") ?? "");
  await guarded(BACK, () => saveAppearance(ctx, { themeMode: String(formData.get("mode") ?? "SYSTEM"), accent: accent || null }));
  revalidatePath("/", "layout");
  redirect(`${BACK}?saved=1`);
}

export async function resetAppearanceAction() {
  const ctx = await requireTenant();
  await saveAppearance(ctx, { themeMode: "SYSTEM", accent: null });
  revalidatePath("/", "layout");
  redirect(`${BACK}?saved=1`);
}

/** Business-wide, owner only: the default colour everyone sees unless they chose their own. */
export async function saveBusinessAccentAction(formData: FormData) {
  const ctx = await requireTenant("owner.control");
  const accent = String(formData.get("accent") ?? "");
  await guarded(BACK, () => saveBusinessAccent(ctx, accent || null));
  revalidatePath("/", "layout");
  redirect(`${BACK}?saved=1`);
}

export async function uploadLogoAction(formData: FormData) {
  const ctx = await requireTenant("owner.control");
  const file = formData.get("logo");
  await guarded(BACK, async () => setLogo(ctx, file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array()));
  revalidatePath("/", "layout");
  redirect(`${BACK}?saved=1`);
}

export async function removeLogoAction() {
  const ctx = await requireTenant("owner.control");
  await guarded(BACK, () => removeLogo(ctx));
  revalidatePath("/", "layout");
  redirect(`${BACK}?saved=1`);
}
