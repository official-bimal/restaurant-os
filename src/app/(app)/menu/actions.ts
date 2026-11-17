"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { removeDishImage, setDishImage } from "@/features/menu/server/images";
import { guarded } from "@/server/guarded";
import {
  createCategory,
  createItem,
  createStation,
  deleteCategory,
  deleteItem,
  deleteStation,
  renameCategory,
  setItemAvailable,
  updateItem,
} from "@/features/menu/server/service";

const BACK = "/menu";

async function done(): Promise<never> {
  revalidatePath(BACK);
  redirect(BACK);
}

const text = z.string().max(200);

export async function createCategoryAction(formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  const name = text.parse(formData.get("name") ?? "");
  const nameNe = text.parse(formData.get("nameNe") ?? "");
  await guarded(BACK, () => createCategory(ctx, name, nameNe));
  await done();
}

export async function renameCategoryAction(id: string, formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  const name = text.parse(formData.get("name") ?? "");
  const nameNe = text.parse(formData.get("nameNe") ?? "");
  await guarded(BACK, () => renameCategory(ctx, id, name, nameNe));
  await done();
}

export async function deleteCategoryAction(id: string) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => deleteCategory(ctx, id));
  await done();
}

const itemSchema = z.object({
  categoryId: z.string().min(1),
  stationId: z.string().optional(),
  name: text,
  nameNe: text.optional(),
  priceRupees: z.coerce.number().finite(),
  prepMinutes: z.coerce.number().int(),
});

function parseItem(formData: FormData) {
  const p = itemSchema.parse({
    categoryId: formData.get("categoryId"),
    stationId: (formData.get("stationId") as string) || undefined,
    name: formData.get("name") ?? "",
    nameNe: formData.get("nameNe") ?? "",
    priceRupees: formData.get("priceRupees"),
    prepMinutes: formData.get("prepMinutes") || 15,
  });
  return {
    categoryId: p.categoryId,
    stationId: p.stationId ?? null,
    name: p.name,
    nameNe: p.nameNe ?? "",
    price: Math.round(p.priceRupees * 100),
    prepMinutes: p.prepMinutes,
  };
}

export async function createItemAction(formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  const input = parseItem(formData);
  await guarded(BACK, () => createItem(ctx, input));
  await done();
}

export async function updateItemAction(id: string, formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  const input = parseItem(formData);
  await guarded(BACK, () => updateItem(ctx, id, input));
  await done();
}

export async function setAvailableAction(id: string, available: boolean) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => setItemAvailable(ctx, id, available));
  await done();
}

export async function deleteItemAction(id: string) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => deleteItem(ctx, id));
  await done();
}

export async function createStationAction(formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  const name = text.parse(formData.get("name") ?? "");
  await guarded(BACK, () => createStation(ctx, name));
  await done();
}

export async function deleteStationAction(id: string) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => deleteStation(ctx, id));
  await done();
}

/** Upload or replace a dish's photo. Answers with an error message instead of redirecting, so the page can show it in place. */
export async function uploadPhotoAction(itemId: string, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireTenant("menu.manage");
  const file = formData.get("photo");
  if (!(file instanceof File)) return { error: "Choose a photo first." };
  try {
    await setDishImage(ctx, itemId, new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(BACK);
  return {};
}

export async function removePhotoAction(itemId: string): Promise<{ error?: string }> {
  const ctx = await requireTenant("menu.manage");
  try {
    await removeDishImage(ctx, itemId);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(BACK);
  return {};
}
