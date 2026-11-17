import { db } from "@/server/db";
import type { Tx } from "@/server/audit";
import { DomainError } from "@/server/errors";

type Db = Tx | typeof db;

/**
 * Stock levels are kept per branch (BranchStock). A branch created after an item, or an item added while a branch was
 * switched off, has no row yet; this adds a zero row for every active item (or the given ones) so reads and updates
 * can always rely on one existing. "Insert unless it exists" keeps it safe when two requests do it at once.
 */
export async function ensureLevels(client: Db, businessId: string, branchId: string, itemIds?: string[]) {
  const items = await client.stockItem.findMany({
    where: { businessId, ...(itemIds ? { id: { in: itemIds } } : { active: true }) },
    select: { id: true },
  });
  if (items.length === 0) return;
  await client.branchStock.createMany({
    data: items.map((i) => ({ businessId, branchId, stockItemId: i.id })),
    skipDuplicates: true,
  });
}

/** One item's level in one branch (creating the zero row first if there is none yet). */
export async function levelFor(client: Db, businessId: string, branchId: string, stockItemId: string) {
  await ensureLevels(client, businessId, branchId, [stockItemId]);
  return client.branchStock.findUniqueOrThrow({ where: { branchId_stockItemId: { branchId, stockItemId } } });
}

/**
 * Like levelFor, but refuses an item this branch has switched off ("not stocked here"). Used wherever stock is
 * bought, wasted, counted or sent: you cannot book stock of something the branch does not keep.
 */
export async function activeLevelFor(client: Db, businessId: string, branchId: string, stockItemId: string) {
  const level = await levelFor(client, businessId, branchId, stockItemId);
  if (!level.active) {
    const item = await client.stockItem.findUnique({ where: { businessId_id: { businessId, id: stockItemId } }, select: { name: true } });
    throw new DomainError(`This branch does not stock ${item?.name ?? "that item"}. Switch it on for this branch first.`);
  }
  return level;
}
