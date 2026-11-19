"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { addCoil, finishHukka, startHukka } from "@/features/hukka/server/service";

const id = z.string().min(1).max(60);

function done(): never {
  revalidatePath("/hukka");
  revalidatePath("/orders", "layout");
  redirect("/hukka");
}

export async function startHukkaAction(orderItemId: string, formData: FormData) {
  const ctx = await requireTenant();
  const minutes = Math.round(Number(formData.get("alert") || 60));
  await guarded("/hukka", () => startHukka(ctx, id.parse(orderItemId), minutes));
  done();
}

export async function addCoilAction(sessionId: string) {
  const ctx = await requireTenant();
  await guarded("/hukka", () => addCoil(ctx, id.parse(sessionId)));
  done();
}

export async function finishHukkaAction(sessionId: string) {
  const ctx = await requireTenant();
  await guarded("/hukka", () => finishHukka(ctx, id.parse(sessionId)));
  done();
}
