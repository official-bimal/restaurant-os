import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { detectImageType, MAX_IMAGE_BYTES } from "../image";

/**
 * Dish photos. Staff with menu rights set or remove a dish's photo; anyone (including a guest who scanned a table's QR)
 * can fetch a photo by the dish's id, because the photo is meant to be shown on the public menu. Nothing else about the
 * dish is exposed by that. Every staff query is filtered by businessId.
 */

function need(ctx: TenantContext) {
  if (!can(ctx, "menu.manage")) throw new DomainError("You do not have permission to change the menu.");
}

export async function setDishImage(ctx: TenantContext, menuItemId: string, data: Uint8Array) {
  need(ctx);
  if (data.length === 0) throw new DomainError("Choose a photo first.");
  if (data.length > MAX_IMAGE_BYTES) throw new DomainError("That photo is too big. Choose a smaller one.");
  const contentType = detectImageType(data);
  if (!contentType) throw new DomainError("Use a JPEG, PNG or WebP photo.");
  await db.$transaction(async (tx) => {
    const dish = await tx.menuItem.findFirst({ where: { id: menuItemId, businessId: ctx.businessId }, select: { name: true } });
    if (!dish) throw new DomainError("Item not found.");
    const bytes = Buffer.from(data);
    await tx.dishImage.upsert({
      where: { businessId_menuItemId: { businessId: ctx.businessId, menuItemId } },
      create: { businessId: ctx.businessId, menuItemId, contentType, bytes: data.length, data: bytes },
      update: { contentType, bytes: data.length, data: bytes },
    });
    await audit(tx, ctx, "menu.item.photo", "MenuItem", menuItemId, { dish: dish.name, bytes: data.length });
  });
}

export async function removeDishImage(ctx: TenantContext, menuItemId: string) {
  need(ctx);
  await db.$transaction(async (tx) => {
    const dish = await tx.menuItem.findFirst({ where: { id: menuItemId, businessId: ctx.businessId }, select: { name: true } });
    if (!dish) throw new DomainError("Item not found.");
    await tx.dishImage.deleteMany({ where: { businessId: ctx.businessId, menuItemId } });
    await audit(tx, ctx, "menu.item.photoRemove", "MenuItem", menuItemId, { dish: dish.name });
  });
}

/** For the public image route: the stored photo of a dish, or null. */
export async function getDishImage(menuItemId: string) {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(menuItemId)) return null;
  const img = await db.dishImage.findFirst({ where: { menuItemId }, select: { contentType: true, data: true, updatedAt: true } });
  return img ? { contentType: img.contentType, data: img.data, updatedAt: img.updatedAt } : null;
}
