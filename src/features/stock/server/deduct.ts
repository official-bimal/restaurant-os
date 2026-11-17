import type { Tx } from "@/server/audit";
import { consumption, costOf, stockStatus } from "@/features/stock/stock";
import { ensureLevels } from "./levels";

/**
 * Take stock off for a bill that has just been paid, from the recipes of what it contained.
 * Runs inside the checkout transaction, so the bill and its stock use are saved together or not
 * at all. Stock is deliberately not blocked: the sale goes through, and the quantity may go
 * negative, which is the cue to count. Dishes without a recipe use nothing.
 *
 * It is the stock of the branch that sold it (the invoice's branch) that goes down, at that branch's average cost.
 *
 * A refund does not put stock back: the food was already made.
 */
export async function deductForInvoice(
  tx: Tx,
  input: {
    businessId: string;
    branchId: string;
    invoiceId: string;
    userId: string;
    items: { menuItemId: string; quantity: number; addOnIds?: string[] }[];
  },
): Promise<{ name: string; status: string }[]> {
  const { businessId, branchId } = input;
  const menuIds = [...new Set(input.items.map((i) => i.menuItemId))];
  if (menuIds.length === 0) return [];

  const lines = await tx.recipeLine.findMany({ where: { businessId, menuItemId: { in: menuIds } } });
  const recipes = new Map<string, { stockItemId: string; quantity: number }[]>();
  for (const l of lines) {
    recipes.set(l.menuItemId, [...(recipes.get(l.menuItemId) ?? []), { stockItemId: l.stockItemId, quantity: l.quantity }]);
  }
  const used = new Map(consumption(input.items, recipes));

  // Add-ons can use stock too (an extra egg, a bigger cup): each choice uses its stock once per dish ordered.
  const addOnIds = [...new Set(input.items.flatMap((i) => i.addOnIds ?? []))];
  if (addOnIds.length > 0) {
    const useRows = await tx.addOnStock.findMany({ where: { businessId, addOnId: { in: addOnIds } } });
    const byAddOn = new Map<string, { stockItemId: string; quantity: number }[]>();
    for (const u of useRows) byAddOn.set(u.addOnId, [...(byAddOn.get(u.addOnId) ?? []), { stockItemId: u.stockItemId, quantity: u.quantity }]);
    for (const item of input.items) {
      for (const addOnId of item.addOnIds ?? []) {
        for (const u of byAddOn.get(addOnId) ?? []) {
          used.set(u.stockItemId, (used.get(u.stockItemId) ?? 0) + u.quantity * item.quantity);
        }
      }
    }
  }
  if (used.size === 0) return [];
  await ensureLevels(tx, businessId, branchId, [...used.keys()]);
  const levels = await tx.branchStock.findMany({
    // A branch that has switched an item off does not stock it, so a sale there does not touch it.
    where: { businessId, branchId, active: true, stockItemId: { in: [...used.keys()] } },
    include: { stockItem: { select: { name: true } } },
  });
  const stock = levels.map((l) => ({ id: l.stockItemId, name: l.stockItem.name, costMilli: l.costMilli, quantity: l.quantity, reorderLevel: l.reorderLevel }));
  const cost = new Map(stock.map((s) => [s.id, s.costMilli]));
  // Items that this sale pushed from fine to low (or out), so the team can be told.
  const crossed = stock
    .filter((s) => {
      const after = s.quantity - (used.get(s.id) ?? 0);
      return stockStatus(s.quantity, s.reorderLevel) === "OK" && stockStatus(after, s.reorderLevel) !== "OK";
    })
    .map((s) => ({ name: s.name, status: stockStatus(s.quantity - (used.get(s.id) ?? 0), s.reorderLevel) }));

  for (const [stockItemId, quantity] of used) {
    if (!cost.has(stockItemId)) continue; // not stocked at this branch
    const costMilli = cost.get(stockItemId) ?? 0;
    await tx.branchStock.update({
      where: { branchId_stockItemId: { branchId, stockItemId } },
      data: { quantity: { decrement: quantity } },
    });
    await tx.stockMovement.create({
      data: {
        businessId,
        branchId,
        stockItemId,
        kind: "SALE",
        quantity: -quantity,
        unitCostMilli: costMilli,
        totalCost: -costOf(quantity, costMilli),
        invoiceId: input.invoiceId,
        createdById: input.userId,
      },
    });
  }
  return crossed;
}
