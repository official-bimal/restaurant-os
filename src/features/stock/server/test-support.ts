import { db } from "@/server/db";

/**
 * Helpers for tests only. Stock is held per branch, so a test that wants "an item with 100 on hand" makes the shared
 * item and the branch's level together, and one that reads quantities reads the branch's level.
 */

export async function makeStockItem(
  businessId: string,
  branchId: string,
  data: { name: string; unit?: string; quantity?: number; reorderLevel?: number; costMilli?: number },
) {
  const item = await db.stockItem.create({ data: { businessId, name: data.name, unit: data.unit ?? "g" } });
  await db.branchStock.create({
    data: {
      businessId,
      branchId,
      stockItemId: item.id,
      quantity: data.quantity ?? 0,
      reorderLevel: data.reorderLevel ?? 0,
      costMilli: data.costMilli ?? 0,
    },
  });
  return item;
}

/** An item with its level in one branch (or, with no branch given, in the business's only branch). */
export async function itemAt(id: string, branchId?: string) {
  const item = await db.stockItem.findUniqueOrThrow({ where: { id } });
  const level = branchId
    ? await db.branchStock.findUniqueOrThrow({ where: { branchId_stockItemId: { branchId, stockItemId: id } } })
    : await db.branchStock.findFirstOrThrow({ where: { stockItemId: id } });
  return { ...item, quantity: level.quantity, reorderLevel: level.reorderLevel, costMilli: level.costMilli };
}
