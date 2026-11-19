"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { deleteStampProgram, saveStampProgram, setStampProgramActive } from "@/features/loyalty/server/stamps";

const id = z.string().min(1).max(60);

function done(): never {
  revalidatePath("/stamps");
  redirect("/stamps");
}

export async function saveStampProgramAction(formData: FormData) {
  const ctx = await requireTenant("campaign.manage");
  await guarded("/stamps", async () => {
    const items: { menuItemId: string | null; categoryId: string | null }[] = [];
    for (let i = 0; i < 4; i++) {
      const v = String(formData.get(`item${i}`) ?? "");
      if (v.startsWith("c:")) items.push({ menuItemId: null, categoryId: id.parse(v.slice(2)) });
      else if (v.startsWith("m:")) items.push({ menuItemId: id.parse(v.slice(2)), categoryId: null });
    }
    await saveStampProgram(ctx, { name: String(formData.get("name") ?? ""), target: Math.floor(Number(formData.get("target") || 0)), items });
  });
  done();
}

export async function toggleStampProgramAction(programId: string, active: boolean) {
  const ctx = await requireTenant("campaign.manage");
  await guarded("/stamps", () => setStampProgramActive(ctx, id.parse(programId), active));
  done();
}

export async function deleteStampProgramAction(programId: string) {
  const ctx = await requireTenant("campaign.manage");
  await guarded("/stamps", () => deleteStampProgram(ctx, id.parse(programId)));
  done();
}
