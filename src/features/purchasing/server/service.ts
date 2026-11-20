import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can, type Permission } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { normalizePhone } from "@/server/phone";
import { isValidDate } from "@/lib/business-day";
import { scope } from "@/server/branch";
import { costOf, stockStatus } from "@/features/stock/stock";
import { ensureLevels } from "@/features/stock/server/levels";
import { applyPurchaseLines } from "@/features/stock/server/service";
import { deliveryState, isComplete, orderText, remaining, suggestQuantity } from "@/features/purchasing/purchasing";

/**
 * Suppliers and purchase orders. The app records an order and the delivery against it; it does
 * not send the order to anyone: staff pass it on themselves and mark it ordered. Receiving puts
 * the goods into the stock of the branch the order is for, at the price actually paid. Suppliers are shared by the
 * business; each purchase order belongs to one branch. Every query is filtered by businessId, and orders by branch.
 */

function need(ctx: TenantContext, permission: Permission = "stock.manage") {
  if (!can(ctx, permission)) throw new DomainError("You do not have permission to do that.");
}

const MAX_QTY = 1_000_000_000;
const MAX_PAISA = 100_000_000_000;

function wholeQty(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_QTY) throw new DomainError("Quantities must be whole numbers above zero.");
  return value;
}

function cleanText(value: string | undefined | null, max: number): string | null {
  const t = (value ?? "").trim().replace(/\s+/g, " ");
  if (t.length > max) throw new DomainError(`That is too long (${max} characters at most).`);
  return t || null;
}

// --- suppliers -----------------------------------------------------------------

export async function listSuppliers(ctx: TenantContext) {
  need(ctx, "stock.view");
  return db.supplier.findMany({ where: { businessId: ctx.businessId, active: true }, orderBy: { name: "asc" } });
}

function supplierFields(input: { name: string; phone?: string; notes?: string; panNumber?: string }) {
  const name = cleanText(input.name, 80);
  if (!name) throw new DomainError("Give the supplier a name.");
  const rawPhone = (input.phone ?? "").trim();
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  const panNumber = (input.panNumber ?? "").trim();
  if (panNumber && !/^\d{9}$/.test(panNumber)) throw new DomainError("A PAN has nine digits.");
  return { name, phone, notes: cleanText(input.notes, 300), panNumber: panNumber || null };
}

export async function createSupplier(ctx: TenantContext, input: { name: string; phone?: string; notes?: string; panNumber?: string }) {
  need(ctx);
  const f = supplierFields(input);
  const clash = await db.supplier.findFirst({ where: { businessId: ctx.businessId, name: { equals: f.name, mode: "insensitive" } } });
  if (clash) throw new DomainError("A supplier with that name already exists.");
  return db.$transaction(async (tx) => {
    const s = await tx.supplier.create({ data: { businessId: ctx.businessId, ...f } });
    await audit(tx, ctx, "supplier.create", "Supplier", s.id, { name: f.name });
    return s;
  });
}

export async function updateSupplier(ctx: TenantContext, id: string, input: { name: string; phone?: string; notes?: string; panNumber?: string }) {
  need(ctx);
  const f = supplierFields(input);
  const s = await db.supplier.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!s) throw new DomainError("Supplier not found.");
  const clash = await db.supplier.findFirst({ where: { businessId: ctx.businessId, name: { equals: f.name, mode: "insensitive" }, id: { not: id } } });
  if (clash) throw new DomainError("A supplier with that name already exists.");
  await db.$transaction(async (tx) => {
    await tx.supplier.update({ where: { businessId_id: { businessId: ctx.businessId, id } }, data: f });
    await audit(tx, ctx, "supplier.update", "Supplier", id, { from: s.name, to: f.name });
  });
}

/** Hide a supplier. Refused while an order to them is still open. */
export async function archiveSupplier(ctx: TenantContext, id: string) {
  need(ctx);
  const s = await db.supplier.findFirst({
    where: { id, businessId: ctx.businessId },
    include: { _count: { select: { purchaseOrders: { where: { status: { in: ["DRAFT", "ORDERED"] } } } } } },
  });
  if (!s) throw new DomainError("Supplier not found.");
  if (s._count.purchaseOrders > 0) throw new DomainError("There is still an open order to this supplier. Finish or cancel it first.");
  await db.$transaction(async (tx) => {
    await tx.supplier.update({ where: { businessId_id: { businessId: ctx.businessId, id } }, data: { active: false } });
    await audit(tx, ctx, "supplier.archive", "Supplier", id, { name: s.name });
  });
}

// --- suggestions ---------------------------------------------------------------

/** Stock that is low, with how much to order after counting what is already on its way. */
export async function suggestedLines(ctx: TenantContext) {
  need(ctx, "stock.view");
  const { businessId, branchId } = scope(ctx);
  await ensureLevels(db, businessId, branchId);
  const [levels, open] = await Promise.all([
    db.branchStock.findMany({
      where: { businessId, branchId, active: true, stockItem: { active: true } },
      include: { stockItem: true },
      orderBy: { stockItem: { name: "asc" } },
    }),
    db.purchaseOrderLine.findMany({
      where: { businessId, purchaseOrder: { status: "ORDERED", branchId } },
      select: { stockItemId: true, quantityOrdered: true, quantityReceived: true },
    }),
  ]);
  const items = levels.map((l) => ({ ...l.stockItem, quantity: l.quantity, reorderLevel: l.reorderLevel, costMilli: l.costMilli }));
  const onOrder = new Map<string, number>();
  for (const l of open) onOrder.set(l.stockItemId, (onOrder.get(l.stockItemId) ?? 0) + remaining(l));
  return items
    .filter((i) => stockStatus(i.quantity, i.reorderLevel) !== "OK")
    .map((i) => {
      const quantity = suggestQuantity({ quantity: i.quantity, reorderLevel: i.reorderLevel, onOrder: onOrder.get(i.id) ?? 0 });
      return { stockItemId: i.id, name: i.name, unit: i.unit, onHand: i.quantity, onOrder: onOrder.get(i.id) ?? 0, quantity, estimatedTotal: costOf(quantity, i.costMilli) };
    })
    .filter((s) => s.quantity > 0);
}

// --- orders --------------------------------------------------------------------

export interface PoLineInput {
  stockItemId: string;
  quantity: number;
  /** Expected total in paisa. Left out, it is worked out from the item's average cost. */
  estimatedTotal?: number;
}

async function checkedLines(tx: Pick<typeof db, "stockItem" | "branchStock">, businessId: string, branchId: string, lines: PoLineInput[]) {
  if (lines.length === 0) throw new DomainError("Add at least one item.");
  if (lines.length > 50) throw new DomainError("That is a lot of items. Please split it into two orders.");
  if (new Set(lines.map((l) => l.stockItemId)).size !== lines.length) throw new DomainError("Each item can appear once.");
  const items = await tx.stockItem.findMany({ where: { businessId, active: true, id: { in: lines.map((l) => l.stockItemId) } } });
  if (items.length !== lines.length) throw new DomainError("One of those stock items was not found.");
  const levels = await tx.branchStock.findMany({ where: { businessId, branchId, stockItemId: { in: items.map((i) => i.id) } }, select: { stockItemId: true, costMilli: true, active: true } });
  if (levels.some((l) => !l.active)) throw new DomainError("This branch does not stock one of those items. Switch it on first.");
  const cost = new Map(levels.map((l) => [l.stockItemId, l.costMilli]));
  return lines.map((l) => {
    const quantity = wholeQty(l.quantity);
    const estimated = l.estimatedTotal ?? costOf(quantity, cost.get(l.stockItemId) ?? 0);
    if (!Number.isInteger(estimated) || estimated < 0 || estimated > MAX_PAISA) throw new DomainError("The expected price must be a whole number of paisa.");
    return { stockItemId: l.stockItemId, quantityOrdered: quantity, estimatedTotal: estimated };
  });
}

function expected(value: string | undefined | null): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (!isValidDate(v)) throw new DomainError("Choose a valid date.");
  return v;
}

export async function createPurchaseOrder(
  ctx: TenantContext,
  input: { supplierId: string; lines: PoLineInput[]; note?: string; expectedOn?: string },
) {
  need(ctx);
  const note = cleanText(input.note, 300);
  const expectedOn = expected(input.expectedOn);
  return db.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, businessId: ctx.businessId, active: true } });
    if (!supplier) throw new DomainError("Supplier not found.");
    const { branchId } = scope(ctx);
    const lines = await checkedLines(tx, ctx.businessId, branchId, input.lines);
    const { poCounter } = await tx.business.update({
      where: { id: ctx.businessId },
      data: { poCounter: { increment: 1 } },
      select: { poCounter: true },
    });
    const po = await tx.purchaseOrder.create({
      data: { businessId: ctx.businessId, branchId, number: poCounter, supplierId: supplier.id, note, expectedOn, createdById: ctx.userId },
    });
    await tx.purchaseOrderLine.createMany({ data: lines.map((l) => ({ businessId: ctx.businessId, purchaseOrderId: po.id, ...l })) });
    await audit(tx, ctx, "po.create", "PurchaseOrder", po.id, { number: po.number, supplier: supplier.name, lines: lines.length });
    return po;
  });
}

/** Change a draft: its items, note and date. Once ordered, an order cannot be edited. */
export async function updateDraft(
  ctx: TenantContext,
  id: string,
  input: { lines: PoLineInput[]; note?: string; expectedOn?: string },
) {
  need(ctx);
  const note = cleanText(input.note, 300);
  const expectedOn = expected(input.expectedOn);
  await db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({ where: { id, ...scope(ctx) } });
    if (!po) throw new DomainError("Purchase order not found.");
    if (po.status !== "DRAFT") throw new DomainError("Only a draft can be changed.");
    const lines = await checkedLines(tx, ctx.businessId, po.branchId, input.lines);
    await tx.purchaseOrderLine.deleteMany({ where: { businessId: ctx.businessId, purchaseOrderId: id } });
    await tx.purchaseOrderLine.createMany({ data: lines.map((l) => ({ businessId: ctx.businessId, purchaseOrderId: id, ...l })) });
    await tx.purchaseOrder.update({ where: { businessId_id: { businessId: ctx.businessId, id } }, data: { note, expectedOn } });
    await audit(tx, ctx, "po.edit", "PurchaseOrder", id, { number: po.number, lines: lines.length });
  });
}

export async function listPurchaseOrders(ctx: TenantContext) {
  need(ctx, "stock.view");
  const orders = await db.purchaseOrder.findMany({
    where: scope(ctx),
    include: { supplier: { select: { name: true } }, lines: true },
    orderBy: { number: "desc" },
    take: 100,
  });
  return orders.map((o) => ({
    ...o,
    state: deliveryState(o.lines),
    estimatedTotal: o.lines.reduce((n, l) => n + l.estimatedTotal, 0),
    paidTotal: o.lines.reduce((n, l) => n + l.paidTotal, 0),
  }));
}

export async function getPurchaseOrder(ctx: TenantContext, id: string) {
  need(ctx, "stock.view");
  const po = await db.purchaseOrder.findFirst({
    where: { id, ...scope(ctx) },
    include: {
      supplier: true,
      branch: { select: { name: true } },
      lines: { include: { stockItem: { select: { name: true, unit: true } } }, orderBy: { stockItem: { name: "asc" } } },
    },
  });
  if (!po) throw new DomainError("Purchase order not found.");
  const business = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { name: true } });
  return {
    ...po,
    state: deliveryState(po.lines),
    text: orderText({
      business: business.name,
      supplier: po.supplier.name,
      number: po.number,
      expectedOn: po.expectedOn,
      note: po.note,
      lines: po.lines.map((l) => ({ name: l.stockItem.name, unit: l.stockItem.unit, quantity: l.quantityOrdered })),
    }),
  };
}

/** A draft from everything that is low, for one supplier. */
export async function createDraftFromLowStock(ctx: TenantContext, supplierId: string) {
  need(ctx);
  const lines = await suggestedLines(ctx);
  if (lines.length === 0) throw new DomainError("Nothing is low right now, or what is low is already on order.");
  return createPurchaseOrder(ctx, {
    supplierId,
    lines: lines.map((l) => ({ stockItemId: l.stockItemId, quantity: l.quantity, estimatedTotal: l.estimatedTotal })),
    note: "From low stock",
  });
}

// --- life of an order ----------------------------------------------------------

/** Staff say they have placed the order with the supplier. */
export async function markOrdered(ctx: TenantContext, id: string) {
  need(ctx);
  await db.$transaction(async (tx) => {
    const res = await tx.purchaseOrder.updateMany({
      where: { id, ...scope(ctx), status: "DRAFT" },
      data: { status: "ORDERED", orderedAt: new Date() },
    });
    if (res.count === 0) {
      const exists = await tx.purchaseOrder.findFirst({ where: { id, ...scope(ctx) }, select: { id: true } });
      throw new DomainError(exists ? "Only a draft can be marked as ordered." : "Purchase order not found.");
    }
    await audit(tx, ctx, "po.ordered", "PurchaseOrder", id);
  });
}

export interface ReceiptLine {
  lineId: string;
  quantity: number;
  /** What was actually paid for this part, in paisa. */
  totalCost: number;
}

/**
 * A delivery arrives, in full or in part. Each part goes into stock at the price paid, and the
 * order is marked received when everything has arrived. You cannot receive more than was ordered.
 */
export async function receiveDelivery(ctx: TenantContext, id: string, receipt: ReceiptLine[]) {
  need(ctx);
  const parts = receipt.filter((r) => r.quantity > 0);
  if (parts.length === 0) throw new DomainError("Enter how much arrived for at least one item.");
  for (const r of parts) {
    wholeQty(r.quantity);
    if (!Number.isInteger(r.totalCost) || r.totalCost < 0 || r.totalCost > MAX_PAISA) {
      throw new DomainError("The price paid must be a whole number of paisa, zero or more.");
    }
  }
  if (new Set(parts.map((r) => r.lineId)).size !== parts.length) throw new DomainError("Something went wrong. Please try again.");

  return db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id, ...scope(ctx) },
      include: { supplier: { select: { name: true } }, lines: true },
    });
    if (!po) throw new DomainError("Purchase order not found.");
    if (po.status !== "ORDERED") throw new DomainError("Only an order that has been placed can receive a delivery.");

    for (const r of parts) {
      const line = po.lines.find((l) => l.id === r.lineId);
      if (!line) throw new DomainError("One of those lines is not on this order.");
      if (r.quantity > remaining(line)) {
        throw new DomainError(`Only ${remaining(line)} more is expected for one of the items. Record any extra as a normal purchase.`);
      }
      // Compare-and-set: two people booking the same delivery cannot both succeed.
      const claimed = await tx.purchaseOrderLine.updateMany({
        where: { id: line.id, businessId: ctx.businessId, quantityReceived: line.quantityReceived },
        data: { quantityReceived: { increment: r.quantity }, paidTotal: { increment: r.totalCost } },
      });
      if (claimed.count === 0) throw new DomainError("This delivery was just booked by someone else. Reload and check.");
      await applyPurchaseLines(
        tx,
        ctx,
        [{ stockItemId: line.stockItemId, quantity: r.quantity, totalCost: r.totalCost }],
        po.supplier.name,
        `PO #${po.number}`,
        po.branchId,
      );
    }

    const lines = await tx.purchaseOrderLine.findMany({ where: { businessId: ctx.businessId, purchaseOrderId: id } });
    const done = isComplete(lines);
    if (done) {
      await tx.purchaseOrder.update({
        where: { businessId_id: { businessId: ctx.businessId, id } },
        data: { status: "RECEIVED", receivedAt: new Date() },
      });
    }
    await audit(tx, ctx, "po.receive", "PurchaseOrder", id, {
      number: po.number,
      parts: parts.length,
      paid: parts.reduce((n, r) => n + r.totalCost, 0),
      complete: done,
    });
    return { complete: done };
  });
}

/** Some of it arrived and the rest is not coming: close it as received and say why. */
export async function closeShort(ctx: TenantContext, id: string, reason: string) {
  need(ctx);
  const note = cleanText(reason, 200);
  if (!note || note.length < 3) throw new DomainError("Say why the rest is not coming (a few words).");
  await db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({ where: { id, ...scope(ctx) }, include: { lines: true } });
    if (!po) throw new DomainError("Purchase order not found.");
    if (po.status !== "ORDERED") throw new DomainError("Only an order that has been placed can be closed.");
    if (deliveryState(po.lines) === "NONE") throw new DomainError("Nothing has arrived. Cancel the order instead.");
    await tx.purchaseOrder.update({
      where: { businessId_id: { businessId: ctx.businessId, id } },
      data: { status: "RECEIVED", receivedAt: new Date(), closeNote: note },
    });
    await audit(tx, ctx, "po.closeShort", "PurchaseOrder", id, { number: po.number, reason: note });
  });
}

/** Cancel a draft, or an order where nothing has arrived. */
export async function cancelPurchaseOrder(ctx: TenantContext, id: string, reason: string) {
  need(ctx);
  const note = cleanText(reason, 200);
  await db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({ where: { id, ...scope(ctx) }, include: { lines: true } });
    if (!po) throw new DomainError("Purchase order not found.");
    if (po.status === "RECEIVED" || po.status === "CANCELLED") throw new DomainError("That order is already finished.");
    if (po.status === "ORDERED") {
      if (!note || note.length < 3) throw new DomainError("Say why you are cancelling an order that was placed.");
      if (deliveryState(po.lines) !== "NONE") throw new DomainError("Some of it has arrived. Close it as received instead.");
    }
    await tx.purchaseOrder.update({
      where: { businessId_id: { businessId: ctx.businessId, id } },
      data: { status: "CANCELLED", cancelledAt: new Date(), closeNote: note },
    });
    await audit(tx, ctx, "po.cancel", "PurchaseOrder", id, { number: po.number, reason: note });
  });
}
