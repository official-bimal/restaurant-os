import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { costOf } from "@/features/stock/stock";
import { ensureLevels } from "@/features/stock/server/levels";
import { remaining } from "@/features/purchasing/purchasing";
import { byUrgency, COVER_CHOICES, dailyUse, dataDays, DEFAULT_COVER, DEFAULT_WINDOW, planItem, WINDOW_CHOICES, type Urgency } from "@/features/purchasing/reorder";
import { createPurchaseOrder } from "./service";

/**
 * Reorder suggestions for the branch the person works in: what to buy from each supplier, worked out from how fast each ingredient is really used
 * (sales and waste over the last weeks), the supplier's lead time and how many days of cover are wanted. Owners and managers. A suggestion becomes a
 * draft purchase order the person can look over and change before ordering.
 */

function need(ctx: TenantContext) {
  if (!can(ctx.role, "stock.manage")) throw new DomainError("You do not have permission to plan stock orders.");
}

export interface ReorderLineOut {
  stockItemId: string;
  name: string;
  unit: string;
  onHand: number;
  onOrder: number;
  dailyUse: number;
  daysLeft: number | null;
  urgency: Urgency;
  quantity: number;
  packQuantity: number;
  /** Rounded to the paisa; 0 when the item has no price yet. */
  estimatedTotal: number;
}

export interface SupplierRef {
  id: string;
  name: string;
  leadDays: number;
}

function pick(value: number | undefined, choices: readonly number[], fallback: number): number {
  return value !== undefined && choices.includes(value) ? value : fallback;
}

export async function getReorderPlan(ctx: TenantContext, opts: { windowDays?: number; coverDays?: number } = {}) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const windowDays = pick(opts.windowDays, WINDOW_CHOICES, DEFAULT_WINDOW);
  const coverDays = pick(opts.coverDays, COVER_CHOICES, DEFAULT_COVER);
  await ensureLevels(db, businessId, branchId);
  const now = new Date();
  const since = new Date(now.getTime() - windowDays * 86_400_000);

  const [levels, onOrderRows, used, firstUse, suppliers] = await Promise.all([
    db.branchStock.findMany({ where: { businessId, branchId, active: true, stockItem: { active: true } }, include: { stockItem: true }, orderBy: { stockItem: { name: "asc" } } }),
    db.purchaseOrderLine.findMany({ where: { businessId, purchaseOrder: { status: "ORDERED", branchId } }, select: { stockItemId: true, quantityOrdered: true, quantityReceived: true } }),
    db.stockMovement.groupBy({ by: ["stockItemId"], where: { businessId, branchId, kind: { in: ["SALE", "WASTE"] }, createdAt: { gte: since } }, _sum: { quantity: true } }),
    db.stockMovement.aggregate({ where: { businessId, branchId, kind: "SALE" }, _min: { createdAt: true } }),
    db.supplier.findMany({ where: { businessId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, leadDays: true } }),
  ]);
  const days = dataDays(firstUse._min.createdAt, now, windowDays);
  const usedBy = new Map(used.map((u) => [u.stockItemId, Math.max(0, -(u._sum.quantity ?? 0))]));
  const onOrder = new Map<string, number>();
  for (const l of onOrderRows) onOrder.set(l.stockItemId, (onOrder.get(l.stockItemId) ?? 0) + remaining(l));
  const supplierOf = new Map(suppliers.map((s) => [s.id, s]));

  const groups = new Map<string | null, ReorderLineOut[]>();
  for (const l of levels) {
    const s = l.stockItem.supplierId ? supplierOf.get(l.stockItem.supplierId) : undefined;
    const rate = dailyUse(usedBy.get(l.stockItemId) ?? 0, days);
    const plan = planItem({ onHand: l.quantity, onOrder: onOrder.get(l.stockItemId) ?? 0, dailyUse: rate, leadDays: s?.leadDays ?? 2, coverDays, packQuantity: l.stockItem.packQuantity, reorderLevel: l.reorderLevel });
    if (plan.quantity === 0) continue;
    const line: ReorderLineOut = {
      stockItemId: l.stockItemId,
      name: l.stockItem.name,
      unit: l.stockItem.unit,
      onHand: l.quantity,
      onOrder: onOrder.get(l.stockItemId) ?? 0,
      dailyUse: rate,
      daysLeft: plan.daysLeft,
      urgency: plan.urgency,
      quantity: plan.quantity,
      packQuantity: l.stockItem.packQuantity,
      estimatedTotal: costOf(plan.quantity, l.costMilli),
    };
    const key = s ? s.id : null;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  const out = [...groups.entries()]
    .map(([id, lines]) => ({ supplier: id ? supplierOf.get(id)! : null, lines: lines.sort(byUrgency), total: lines.reduce((n, x) => n + x.estimatedTotal, 0), urgent: lines.filter((x) => x.urgency === "NOW").length }))
    .sort((a, b) => (a.supplier === null ? 1 : 0) - (b.supplier === null ? 1 : 0) || b.urgent - a.urgent || (a.supplier?.name ?? "").localeCompare(b.supplier?.name ?? ""));
  return { windowDays, coverDays, dataDays: days, groups: out, suppliers };
}

/** Everything the set-up part of the page needs: each stock item with its supplier and pack size. */
export async function getSupplyList(ctx: TenantContext) {
  need(ctx);
  const items = await db.stockItem.findMany({ where: { businessId: ctx.businessId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, supplierId: true, packQuantity: true } });
  return items;
}

/** Sets who an item is usually bought from and how many base units come in a pack. */
export async function setItemSupply(ctx: TenantContext, stockItemId: string, input: { supplierId: string | null; packQuantity: number }) {
  need(ctx);
  if (!Number.isInteger(input.packQuantity) || input.packQuantity < 1 || input.packQuantity > 10_000_000) throw new DomainError("The pack size must be a whole number of 1 or more.");
  await db.$transaction(async (tx) => {
    const item = await tx.stockItem.findFirst({ where: { id: stockItemId, businessId: ctx.businessId } });
    if (!item) throw new DomainError("Stock item not found.");
    if (input.supplierId && !(await tx.supplier.findFirst({ where: { id: input.supplierId, businessId: ctx.businessId, active: true } }))) throw new DomainError("Supplier not found.");
    await tx.stockItem.update({ where: { businessId_id: { businessId: ctx.businessId, id: stockItemId } }, data: { supplierId: input.supplierId, packQuantity: input.packQuantity } });
    await audit(tx, ctx, "stock.supply", "StockItem", stockItemId, { name: item.name, supplierId: input.supplierId, pack: input.packQuantity });
  });
}

export async function setSupplierLeadDays(ctx: TenantContext, supplierId: string, days: number) {
  need(ctx);
  if (!Number.isInteger(days) || days < 0 || days > 60) throw new DomainError("Lead time must be 0 to 60 days.");
  await db.$transaction(async (tx) => {
    const r = await tx.supplier.updateMany({ where: { id: supplierId, businessId: ctx.businessId }, data: { leadDays: days } });
    if (r.count === 0) throw new DomainError("Supplier not found.");
    await audit(tx, ctx, "supplier.lead", "Supplier", supplierId, { days });
  });
}

/**
 * Makes a draft purchase order from the current suggestion for one supplier. Items with no usual supplier go to the supplier chosen here.
 * The plan is worked out again now, so the draft matches what is on the shelves at this moment.
 */
export async function createDraftFromReorder(ctx: TenantContext, input: { supplierId: string | "none"; chooseSupplierId?: string; windowDays?: number; coverDays?: number }) {
  need(ctx);
  const plan = await getReorderPlan(ctx, input);
  const group = plan.groups.find((g) => (input.supplierId === "none" ? g.supplier === null : g.supplier?.id === input.supplierId));
  if (!group || group.lines.length === 0) throw new DomainError("There is nothing to order for that supplier right now.");
  const supplierId = group.supplier ? group.supplier.id : input.chooseSupplierId;
  if (!supplierId) throw new DomainError("Choose which supplier to order these from.");
  const po = await createPurchaseOrder(ctx, {
    supplierId,
    lines: group.lines.map((l) => ({ stockItemId: l.stockItemId, quantity: l.quantity, estimatedTotal: l.estimatedTotal })),
    note: `Reorder suggestion: ${plan.windowDays}-day use, ${plan.coverDays} days of cover`,
  });
  return po;
}
