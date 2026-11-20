import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";
import { pushToTeam } from "@/features/notifications/server/push";
import { costOf, stockStatus, weightedAverageCost } from "@/features/stock/stock";
import { activeLevelFor, ensureLevels, levelFor } from "./levels";

/**
 * Moving stock between branches, and seeing every branch's levels side by side.
 *
 * A transfer leaves the sending branch at once. Unless it is sent as "arrives now", it is then IN TRANSIT: nobody's
 * stock until the receiving branch books it in (counting what actually arrived), or it is cancelled and goes back.
 * It travels at the sender's average cost, which is folded into the receiver's average when it arrives. If less arrives
 * than was sent, the difference is recorded on the transfer as lost on the way. Everything is filtered by business.
 */

const MAX_QTY = 1_000_000_000;

function needManage(ctx: TenantContext) {
  if (!can(ctx, "stock.manage")) throw new DomainError("You do not have permission to move stock.");
}
function needView(ctx: TenantContext) {
  if (!can(ctx, "stock.view")) throw new DomainError("You do not have permission to see stock.");
}

/** Other active branches of the business that stock can be sent to. */
export async function listTransferTargets(ctx: TenantContext) {
  needView(ctx);
  return db.branch.findMany({
    where: { businessId: ctx.businessId, active: true, id: { not: ctx.branchId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
}

/** Book stock into the receiving branch and write its movement. Shared by "arrives now" and by receiving a transfer. */
async function bookIn(
  tx: Tx,
  ctx: TenantContext,
  t: { id: string; businessId: string; toBranchId: string; stockItemId: string; unitCostMilli: number; note: string | null },
  quantity: number,
  fromName: string,
) {
  const dest = await activeLevelFor(tx, t.businessId, t.toBranchId, t.stockItemId);
  const totalCost = costOf(quantity, t.unitCostMilli);
  if (quantity > 0) {
    await tx.branchStock.update({
      where: { branchId_stockItemId: { branchId: t.toBranchId, stockItemId: t.stockItemId } },
      data: {
        quantity: { increment: quantity },
        costMilli: weightedAverageCost(dest.quantity, dest.costMilli, quantity, totalCost),
      },
    });
    await tx.stockMovement.create({
      data: {
        businessId: t.businessId,
        branchId: t.toBranchId,
        stockItemId: t.stockItemId,
        kind: "TRANSFER_IN",
        quantity,
        unitCostMilli: t.unitCostMilli,
        totalCost,
        note: t.note ? `From ${fromName}: ${t.note}` : `From ${fromName}`,
        createdById: ctx.userId,
      },
    });
  }
}

/**
 * Send stock from the branch you are working in to another. You cannot send more than the branch has: unlike a sale,
 * which may take a count below zero, a transfer is a decision to ship something, so it must be there.
 * Set `arrivesNow` for small things carried over at once: it is booked into the other branch in the same step.
 */
export async function transferStock(
  ctx: TenantContext,
  input: { toBranchId: string; stockItemId: string; quantity: number; note?: string; arrivesNow?: boolean },
) {
  needManage(ctx);
  const { businessId, branchId: fromBranchId } = scope(ctx);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > MAX_QTY) {
    throw new DomainError("Quantity must be a whole number above zero.");
  }
  if (input.toBranchId === fromBranchId) throw new DomainError("Choose a different branch to send it to.");
  const note = input.note?.trim().replace(/\s+/g, " ").slice(0, 200) || null;

  const result = await db.$transaction(async (tx) => {
    const [item, to] = await Promise.all([
      tx.stockItem.findFirst({ where: { id: input.stockItemId, businessId, active: true } }),
      tx.branch.findFirst({ where: { id: input.toBranchId, businessId, active: true } }),
    ]);
    if (!item) throw new DomainError("Stock item not found.");
    if (!to) throw new DomainError("That branch is not available.");

    const from = await activeLevelFor(tx, businessId, fromBranchId, item.id);
    const toLevel = await levelFor(tx, businessId, to.id, item.id);
    if (!toLevel.active) throw new DomainError(`${to.name} does not stock ${item.name}.`);

    // Compare-and-set on the sender: two people sending the same stock at once cannot both pass the check.
    const taken = await tx.branchStock.updateMany({
      where: { branchId: fromBranchId, stockItemId: item.id, quantity: { gte: input.quantity } },
      data: { quantity: { decrement: input.quantity } },
    });
    if (taken.count === 0) {
      throw new DomainError(`This branch only has ${Math.max(0, from.quantity).toLocaleString("en-US")} ${item.unit} of ${item.name}.`);
    }

    const fromBranch = await tx.branch.findUniqueOrThrow({ where: { businessId_id: { businessId, id: fromBranchId } }, select: { name: true } });
    const transfer = await tx.stockTransfer.create({
      data: {
        businessId,
        fromBranchId,
        toBranchId: to.id,
        stockItemId: item.id,
        quantity: input.quantity,
        unitCostMilli: from.costMilli,
        note,
        createdById: ctx.userId,
        status: "IN_TRANSIT",
      },
    });
    await tx.stockMovement.create({
      data: {
        businessId,
        branchId: fromBranchId,
        stockItemId: item.id,
        kind: "TRANSFER_OUT",
        quantity: -input.quantity,
        unitCostMilli: from.costMilli,
        totalCost: -costOf(input.quantity, from.costMilli),
        note: note ? `To ${to.name}: ${note}` : `To ${to.name}`,
        createdById: ctx.userId,
      },
    });

    let status: "IN_TRANSIT" | "RECEIVED" = "IN_TRANSIT";
    if (input.arrivesNow) {
      await bookIn(tx, ctx, transfer, input.quantity, fromBranch.name);
      await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: "RECEIVED", receivedQuantity: input.quantity, receivedAt: new Date(), receivedById: ctx.userId },
      });
      status = "RECEIVED";
    }
    await audit(tx, ctx, "stock.transfer", "StockTransfer", transfer.id, {
      item: item.name,
      quantity: input.quantity,
      from: fromBranch.name,
      to: to.name,
      status,
    });
    return { transfer: { ...transfer, status }, itemName: item.name, unit: item.unit, fromName: fromBranch.name };
  });

  if (result.transfer.status === "IN_TRANSIT") {
    // Tell the receiving branch's stock people something is coming, even if their app is closed.
    void pushToTeam({
      businessId,
      branchId: input.toBranchId,
      permission: "stock.manage",
      payload: {
        title: "Stock is on its way",
        body: `${input.quantity.toLocaleString("en-US")} ${result.unit} of ${result.itemName} from ${result.fromName}.`,
        url: "/stock/branches",
        tag: `transfer-${result.transfer.id}`,
      },
    });
  }
  return result.transfer;
}

/**
 * The receiving branch books a transfer in. By default everything arrived; if less did, say how much, and the difference
 * is recorded as lost on the way. Only the receiving branch can do this, and only once.
 */
export async function receiveTransfer(ctx: TenantContext, transferId: string, receivedQuantity?: number) {
  needManage(ctx);
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const t = await tx.stockTransfer.findFirst({
      where: { id: transferId, businessId, toBranchId: branchId },
      include: { from: { select: { name: true } }, stockItem: { select: { name: true } } },
    });
    if (!t) throw new DomainError("Transfer not found.");
    if (t.status !== "IN_TRANSIT") throw new DomainError(t.status === "RECEIVED" ? "That transfer was already received." : "That transfer was cancelled.");
    const got = receivedQuantity ?? t.quantity;
    if (!Number.isInteger(got) || got < 0 || got > t.quantity) {
      throw new DomainError(`Enter how much arrived, a whole number from 0 to ${t.quantity.toLocaleString("en-US")}.`);
    }
    // Claim it first: if two people press Receive at once, only one gets through.
    const claimed = await tx.stockTransfer.updateMany({
      where: { id: t.id, businessId, status: "IN_TRANSIT" },
      data: { status: "RECEIVED", receivedQuantity: got, receivedAt: new Date(), receivedById: ctx.userId },
    });
    if (claimed.count === 0) throw new DomainError("That transfer was just handled by someone else.");
    await bookIn(tx, ctx, t, got, t.from.name);
    await audit(tx, ctx, "stock.transfer.receive", "StockTransfer", t.id, { item: t.stockItem.name, sent: t.quantity, received: got });
  });
}

/**
 * Call off a transfer that has not arrived: the stock goes back to the sending branch. Either branch can do it
 * (the sender changed their mind, or the receiver refuses it).
 */
export async function cancelTransfer(ctx: TenantContext, transferId: string, reason?: string) {
  needManage(ctx);
  const { businessId, branchId } = scope(ctx);
  const why = reason?.trim().replace(/\s+/g, " ").slice(0, 200) || null;
  await db.$transaction(async (tx) => {
    const t = await tx.stockTransfer.findFirst({
      where: { id: transferId, businessId, OR: [{ fromBranchId: branchId }, { toBranchId: branchId }] },
      include: { to: { select: { name: true } }, stockItem: { select: { name: true } } },
    });
    if (!t) throw new DomainError("Transfer not found.");
    if (t.status !== "IN_TRANSIT") throw new DomainError(t.status === "RECEIVED" ? "That transfer already arrived. Send it back as a new transfer." : "That transfer was already cancelled.");
    const claimed = await tx.stockTransfer.updateMany({
      where: { id: t.id, businessId, status: "IN_TRANSIT" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.userId },
    });
    if (claimed.count === 0) throw new DomainError("That transfer was just handled by someone else.");

    // Back into the sender's stock at the cost it left with (it may have been switched off meanwhile; it is still theirs).
    const back = await levelFor(tx, businessId, t.fromBranchId, t.stockItemId);
    const totalCost = costOf(t.quantity, t.unitCostMilli);
    await tx.branchStock.update({
      where: { branchId_stockItemId: { branchId: t.fromBranchId, stockItemId: t.stockItemId } },
      data: { quantity: { increment: t.quantity }, costMilli: weightedAverageCost(back.quantity, back.costMilli, t.quantity, totalCost) },
    });
    await tx.stockMovement.create({
      data: {
        businessId,
        branchId: t.fromBranchId,
        stockItemId: t.stockItemId,
        kind: "TRANSFER_IN",
        quantity: t.quantity,
        unitCostMilli: t.unitCostMilli,
        totalCost,
        note: why ? `Returned (not sent to ${t.to.name}): ${why}` : `Returned (not sent to ${t.to.name})`,
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, "stock.transfer.cancel", "StockTransfer", t.id, { item: t.stockItem.name, quantity: t.quantity, reason: why });
  });
}

/** Recent transfers sent from or received by the branch you are working in. */
export async function listTransfers(ctx: TenantContext, limit = 40) {
  needView(ctx);
  const { businessId, branchId } = scope(ctx);
  const rows = await db.stockTransfer.findMany({
    where: { businessId, OR: [{ fromBranchId: branchId }, { toBranchId: branchId }] },
    include: {
      stockItem: { select: { name: true, unit: true } },
      from: { select: { name: true } },
      to: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
  });
  return rows.map((t) => ({
    ...t,
    direction: t.fromBranchId === branchId ? ("OUT" as const) : ("IN" as const),
    lost: t.status === "RECEIVED" && t.receivedQuantity !== null ? t.quantity - t.receivedQuantity : 0,
  }));
}

/** What is on its way to the branch you are working in, waiting to be booked in. */
export async function listIncoming(ctx: TenantContext) {
  needView(ctx);
  return db.stockTransfer.findMany({
    where: { businessId: ctx.businessId, toBranchId: ctx.branchId, status: "IN_TRANSIT" },
    include: { stockItem: { select: { name: true, unit: true } }, from: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Every item's quantity in each branch the person works in, side by side, with what is on its way to each. People
 * limited to some branches see only those; nobody sees a branch they have no access to.
 */
export async function stockOverview(ctx: TenantContext) {
  needView(ctx);
  const { businessId } = ctx;
  const branches = await db.branch.findMany({
    where: { businessId, active: true, id: { in: ctx.branchIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  await Promise.all(branches.map((b) => ensureLevels(db, businessId, b.id)));
  const [items, levels, transit] = await Promise.all([
    db.stockItem.findMany({ where: { businessId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true } }),
    db.branchStock.findMany({ where: { businessId, branchId: { in: branches.map((b) => b.id) } } }),
    db.stockTransfer.groupBy({
      by: ["toBranchId", "stockItemId"],
      where: { businessId, status: "IN_TRANSIT", toBranchId: { in: branches.map((b) => b.id) } },
      _sum: { quantity: true },
    }),
  ]);
  const byKey = new Map(levels.map((l) => [`${l.branchId}:${l.stockItemId}`, l]));
  const coming = new Map(transit.map((t) => [`${t.toBranchId}:${t.stockItemId}`, t._sum.quantity ?? 0]));
  return {
    branches,
    rows: items.map((i) => ({
      ...i,
      perBranch: branches.map((b) => {
        const l = byKey.get(`${b.id}:${i.id}`);
        const quantity = l?.quantity ?? 0;
        const reorderLevel = l?.reorderLevel ?? 0;
        return {
          branchId: b.id,
          quantity,
          reorderLevel,
          stocked: l?.active ?? true,
          onTheWay: coming.get(`${b.id}:${i.id}`) ?? 0,
          status: stockStatus(quantity, reorderLevel),
        };
      }),
    })),
  };
}
