"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { saveFloorPlan } from "@/features/floor/server/service";

const positions = z
  .array(z.object({ tableId: z.string().min(1).max(60), x: z.number().finite(), y: z.number().finite() }))
  .max(200)
  .nullable();

/** Saves one area's floor plan (or clears it with null). Answers with a message instead of redirecting, so the editor can show it in place. */
export async function savePlanAction(areaId: string, input: unknown): Promise<{ error?: string }> {
  const ctx = await requireTenant("floor.manage");
  const parsed = positions.safeParse(input);
  if (!parsed.success) return { error: "Something is wrong with that plan. Please try again." };
  try {
    await saveFloorPlan(ctx, z.string().min(1).max(60).parse(areaId), parsed.data);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/orders");
  revalidatePath("/tables/layout");
  return {};
}
