"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { removeLogo, saveProfile, setLogo } from "@/features/business/server/profile";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function saveProfileAction(formData: FormData) {
  const ctx = await requireTenant("owner.control");
  await guarded("/settings/profile", () =>
    saveProfile(ctx, {
      name: s(formData, "name"),
      legalName: s(formData, "legalName"),
      panNumber: s(formData, "panNumber"),
      phone: s(formData, "phone"),
      email: s(formData, "email"),
      address: s(formData, "address"),
      businessType: s(formData, "businessType"),
      openedOn: s(formData, "openedOn"),
      website: s(formData, "website"),
      facebook: s(formData, "facebook"),
      instagram: s(formData, "instagram"),
    }),
  );
  revalidatePath("/", "layout");
  redirect("/settings/profile?saved=1");
}

export async function logoAction(formData: FormData) {
  const ctx = await requireTenant("owner.control");
  const file = formData.get("logo");
  await guarded("/settings/profile", async () => setLogo(ctx, file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array()));
  revalidatePath("/", "layout");
  redirect("/settings/profile?saved=1");
}

export async function removeLogoAction() {
  const ctx = await requireTenant("owner.control");
  await guarded("/settings/profile", () => removeLogo(ctx));
  revalidatePath("/", "layout");
  redirect("/settings/profile?saved=1");
}
