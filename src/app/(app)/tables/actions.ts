"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import {
  createArea,
  createTable,
  deleteArea,
  deleteTable,
  renameArea,
  resetTableQr,
  setGuestSettings,
  updateTable,
} from "@/features/floor/server/service";

const BACK = "/tables";

async function done(): Promise<never> {
  revalidatePath(BACK);
  redirect(BACK);
}

const text = z.string().max(100);

export async function createAreaAction(formData: FormData) {
  const ctx = await requireTenant("floor.manage");
  const name = text.parse(formData.get("name") ?? "");
  await guarded(BACK, () => createArea(ctx, name));
  await done();
}

export async function renameAreaAction(id: string, formData: FormData) {
  const ctx = await requireTenant("floor.manage");
  const name = text.parse(formData.get("name") ?? "");
  await guarded(BACK, () => renameArea(ctx, id, name));
  await done();
}

export async function deleteAreaAction(id: string) {
  const ctx = await requireTenant("floor.manage");
  await guarded(BACK, () => deleteArea(ctx, id));
  await done();
}

const tableSchema = z.object({
  areaId: z.string().min(1),
  label: text,
  capacity: z.coerce.number().int(),
});

function parseTable(formData: FormData) {
  return tableSchema.parse({
    areaId: formData.get("areaId"),
    label: formData.get("label") ?? "",
    capacity: formData.get("capacity") || 4,
  });
}

export async function createTableAction(formData: FormData) {
  const ctx = await requireTenant("floor.manage");
  const input = parseTable(formData);
  await guarded(BACK, () => createTable(ctx, input));
  await done();
}

export async function updateTableAction(id: string, formData: FormData) {
  const ctx = await requireTenant("floor.manage");
  const input = parseTable(formData);
  await guarded(BACK, () => updateTable(ctx, id, input));
  await done();
}

export async function deleteTableAction(id: string) {
  const ctx = await requireTenant("floor.manage");
  await guarded(BACK, () => deleteTable(ctx, id));
  await done();
}

export async function setGuestSettingsAction(formData: FormData) {
  const ctx = await requireTenant("floor.manage");
  // Unchecked checkboxes are simply absent from the form.
  const input = {
    enabled: formData.get("enabled") === "on",
    requireApproval: formData.get("requireApproval") === "on",
    bestSellers: formData.get("bestSellers") === "on",
  };
  await guarded(BACK, () => setGuestSettings(ctx, input));
  await done();
}

export async function resetQrAction(id: string) {
  const ctx = await requireTenant("floor.manage");
  await guarded(BACK, () => resetTableQr(ctx, id));
  await done();
}
