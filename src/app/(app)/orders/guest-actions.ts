"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { acceptSubmission, completeRequest, rejectSubmission } from "@/features/guest/server/service";

const BACK = "/orders";

async function done(): Promise<never> {
  revalidatePath(BACK);
  redirect(BACK);
}

export async function acceptSubmissionAction(id: string) {
  const ctx = await requireTenant("order.edit");
  await guarded(BACK, () => acceptSubmission(ctx, id));
  await done();
}

export async function rejectSubmissionAction(id: string, formData: FormData) {
  const ctx = await requireTenant("order.edit");
  const reason = z.string().max(200).parse(formData.get("reason") ?? "");
  await guarded(BACK, () => rejectSubmission(ctx, id, reason));
  await done();
}

export async function completeRequestAction(id: string) {
  const ctx = await requireTenant("order.edit");
  await guarded(BACK, () => completeRequest(ctx, id));
  await done();
}
