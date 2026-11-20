import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { TRASH_DAYS, trashCutoff, type DishSnapshot } from "../trash";

type Tx = Prisma.TransactionClient;

/** Called inside the delete: keeps a copy of the dish and its recipe so the owner can put it back. */
export async function keepDeletedDish(tx: Tx, ctx: TenantContext, dishId: string) {
  const d = await tx.menuItem.findFirst({ where: { id: dishId, businessId: ctx.businessId }, include: { recipe: true } });
  if (!d) return;
  const snap: DishSnapshot = {
    id: d.id,
    categoryId: d.categoryId,
    stationId: d.stationId,
    name: d.name,
    nameNe: d.nameNe,
    price: d.price,
    prepMinutes: d.prepMinutes,
    available: d.available,
    recipe: d.recipe.map((r) => ({ stockItemId: r.stockItemId, quantity: r.quantity })),
  };
  await tx.trashItem.create({ data: { businessId: ctx.businessId, kind: "DISH", label: d.name, payload: snap as unknown as Prisma.InputJsonValue, deletedById: ctx.userId } });
}

function need(ctx: TenantContext) {
  if (!can(ctx, "menu.manage")) throw new DomainError("You do not have permission to use the Trash.");
}

/** What is in the Trash, newest first. Anything older than the keeping time is removed first. */
export async function listTrash(ctx: TenantContext, now = new Date()) {
  need(ctx);
  await db.trashItem.deleteMany({ where: { businessId: ctx.businessId, deletedAt: { lt: trashCutoff(now) } } });
  const rows = await db.trashItem.findMany({ where: { businessId: ctx.businessId }, orderBy: { deletedAt: "desc" }, take: 200 });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.deletedById).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    label: r.label,
    deletedAt: r.deletedAt,
    by: r.deletedById ? (names.get(r.deletedById) ?? "Unknown") : "System",
    daysLeft: Math.max(0, TRASH_DAYS - Math.floor((now.getTime() - r.deletedAt.getTime()) / 86_400_000)),
  }));
}

export async function restoreFromTrash(ctx: TenantContext, id: string) {
  need(ctx);
  const t = await db.trashItem.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!t) throw new DomainError("That item is no longer in the Trash.");
  if (t.kind !== "DISH") throw new DomainError("This kind of item cannot be restored.");
  const s = t.payload as unknown as DishSnapshot;
  const [category, station, taken] = await Promise.all([
    db.menuCategory.findFirst({ where: { id: s.categoryId, businessId: ctx.businessId }, select: { id: true } }),
    s.stationId ? db.station.findFirst({ where: { id: s.stationId, businessId: ctx.businessId }, select: { id: true } }) : null,
    db.menuItem.findFirst({ where: { businessId: ctx.businessId, id: s.id }, select: { id: true } }),
  ]);
  if (!category) throw new DomainError(`The category of "${s.name}" has been deleted, so the dish cannot go back. Make the category again first.`);
  if (taken) throw new DomainError("This dish is already on the menu.");
  const stock = s.recipe.length ? await db.stockItem.findMany({ where: { businessId: ctx.businessId, id: { in: s.recipe.map((r) => r.stockItemId) } }, select: { id: true } }) : [];
  const have = new Set(stock.map((i) => i.id));
  await db.$transaction(async (tx) => {
    await tx.menuItem.create({
      data: { id: s.id, businessId: ctx.businessId, categoryId: s.categoryId, stationId: station ? s.stationId : null, name: s.name, nameNe: s.nameNe, price: s.price, prepMinutes: s.prepMinutes, available: s.available },
    });
    const lines = s.recipe.filter((r) => have.has(r.stockItemId));
    if (lines.length) await tx.recipeLine.createMany({ data: lines.map((r) => ({ businessId: ctx.businessId, menuItemId: s.id, stockItemId: r.stockItemId, quantity: r.quantity })) });
    await tx.trashItem.delete({ where: { id: t.id } });
    await audit(tx, ctx, "trash.restore", "MenuItem", s.id, { name: s.name });
  });
}

export async function emptyTrashItem(ctx: TenantContext, id: string) {
  need(ctx);
  const t = await db.trashItem.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!t) return;
  await db.$transaction(async (tx) => {
    await tx.trashItem.delete({ where: { id } });
    await audit(tx, ctx, "trash.purge", "TrashItem", id, { name: t.label });
  });
}
