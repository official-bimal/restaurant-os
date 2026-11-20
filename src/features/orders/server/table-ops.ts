import { naturalCompare } from "@/lib/natural";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";
import { scope } from "@/server/branch";
import { Prisma } from "@/generated/prisma/client";
import { closeTableSittingsInTx } from "@/features/guest/server/service";
import { syncOrderStatus } from "./sync";
import { MAX_GUESTS, planSplit, shareName, type Assignment, type SplitItem } from "@/features/billing/split-items";

/**
 * Move a party to another table, merge two bills into one, split one bill into two.
 * All of these change who pays what, so they need the "order.restructure" permission and
 * every one is written to the audit log. Every query is filtered by businessId.
 */

function need(ctx: TenantContext) {
  if (!can(ctx, "order.restructure")) throw new DomainError("You do not have permission to move, merge or split bills.");
}

const OPEN = ["OPEN", "SERVED"] as const;

async function loadOpenOrder(tx: Tx, businessId: string, branchId: string, id: string) {
  const order = await tx.order.findFirst({ where: { id, businessId, branchId }, include: { items: { include: { addOns: true } } } });
  if (!order) throw new DomainError("Order not found.");
  if (order.status === "PAID") throw new DomainError("That bill is already paid.");
  if (order.status === "CANCELLED") throw new DomainError("That order was cancelled.");
  if (order.status === "MERGED") throw new DomainError("That order was merged into another one.");
  return order;
}

// --- what the screen can offer -----------------------------------------------

export async function listRestructureOptions(ctx: TenantContext, orderId: string) {
  need(ctx);
  const order = await db.order.findFirst({ where: { id: orderId, ...scope(ctx) } });
  if (!order) throw new DomainError("Order not found.");

  const [tables, openOrders] = await Promise.all([
    db.diningTable.findMany({
      where: { ...scope(ctx), state: "FREE", orders: { none: { status: { in: [...OPEN] } } } },
      include: { area: { select: { name: true } } },
      orderBy: [{ area: { sortOrder: "asc" } }, { label: "asc" }],
    }),
    db.order.findMany({
      where: { ...scope(ctx), status: { in: [...OPEN] }, id: { not: orderId } },
      include: { table: { select: { label: true } }, items: { select: { status: true } } },
      orderBy: { number: "asc" },
    }),
  ]);
  const rank = new Map<string, number>();
  for (const t of tables) if (!rank.has(t.areaId)) rank.set(t.areaId, rank.size);
  const free = tables.sort((a, b) => rank.get(a.areaId)! - rank.get(b.areaId)! || naturalCompare(a.label, b.label));
  return {
    freeTables: order.tableId ? free.filter((t) => t.id !== order.tableId) : [],
    mergeTargets: openOrders.map((o) => ({
      id: o.id,
      number: o.number,
      tableLabel: o.table?.label ?? null,
      itemCount: o.items.filter((i) => i.status !== "CANCELLED").length,
    })),
  };
}

// --- move --------------------------------------------------------------------

/** Move the party (every open bill on this order's table) to a free table. */
export async function moveToTable(ctx: TenantContext, orderId: string, targetTableId: string) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const order = await loadOpenOrder(tx, businessId, branchId, orderId);
    if (!order.tableId) throw new DomainError("Takeaway orders do not have a table to move.");
    if (order.tableId === targetTableId) throw new DomainError("That is already this order's table.");

    // Two staff moving different parties onto the same free table: one waits here, then sees it is taken.
    await tx.$queryRaw`SELECT id FROM "DiningTable" WHERE id = ${targetTableId} AND "businessId" = ${businessId} FOR UPDATE`;
    const target = await tx.diningTable.findFirst({ where: { id: targetTableId, businessId, branchId } });
    if (!target) throw new DomainError("Table not found.");
    const busy = await tx.order.count({ where: { businessId, tableId: target.id, status: { in: [...OPEN] } } });
    if (busy > 0 || target.state !== "FREE") throw new DomainError(`${target.label} is not free.`);

    const source = await tx.diningTable.findFirstOrThrow({ where: { id: order.tableId, businessId } });
    await tx.order.updateMany({
      where: { businessId, tableId: source.id, status: { in: [...OPEN] } },
      data: { tableId: target.id },
    });
    await tx.diningTable.update({
      where: { businessId_id: { businessId, id: target.id } },
      data: { state: source.state === "FREE" ? "SEATED" : source.state },
    });
    await tx.diningTable.update({ where: { businessId_id: { businessId, id: source.id } }, data: { state: "FREE" } });

    // Phones are tied to the old table; they need to scan the new table's QR (and any not yet accepted are declined).
    await closeTableSittingsInTx(tx, businessId, source.id, { reason: "MOVED" });
    // Whoever had scanned the destination before the party arrived is also moved on.
    await closeTableSittingsInTx(tx, businessId, target.id, { reason: "MOVED" });
    await audit(tx, ctx, "order.moveTable", "Order", orderId, { from: source.label, to: target.label });
  });
}

// --- merge -------------------------------------------------------------------

/** Fold one open bill into another. The source keeps its number as a MERGED record. */
export async function mergeOrders(ctx: TenantContext, sourceId: string, targetId: string) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  if (sourceId === targetId) throw new DomainError("Choose a different bill to merge into.");
  await db.$transaction(async (tx) => {
    const source = await loadOpenOrder(tx, businessId, branchId, sourceId);
    const target = await loadOpenOrder(tx, businessId, branchId, targetId);

    await tx.orderItem.updateMany({ where: { businessId, orderId: source.id }, data: { orderId: target.id } });
    await tx.order.update({
      where: { businessId_id: { businessId, id: source.id } },
      data: { status: "MERGED", mergedIntoId: target.id, closedAt: new Date(), customerId: null, customerConfirmed: false },
    });
    // The customer follows the bill if the target had none (their confirmation status travels with them).
    if (!target.customerId && source.customerId) {
      await tx.order.update({
        where: { businessId_id: { businessId, id: target.id } },
        data: { customerId: source.customerId, customerConfirmed: source.customerConfirmed },
      });
    }
    await syncOrderStatus(tx, businessId, target.id);

    if (source.tableId && source.tableId !== target.tableId) {
      const stillOpen = await tx.order.count({ where: { businessId, tableId: source.tableId, status: { in: [...OPEN] } } });
      if (stillOpen === 0) {
        const sourceTable = await tx.diningTable.findFirstOrThrow({ where: { id: source.tableId, businessId } });
        if (sourceTable.state === "BILL_REQUESTED" && target.tableId) {
          await tx.diningTable.update({
            where: { businessId_id: { businessId, id: target.tableId } },
            data: { state: "BILL_REQUESTED" },
          });
        }
        await tx.diningTable.update({ where: { businessId_id: { businessId, id: source.tableId } }, data: { state: "FREE" } });
        await closeTableSittingsInTx(tx, businessId, source.tableId, { reason: "MERGED" });
      }
    }
    await audit(tx, ctx, "order.merge", "Order", sourceId, {
      into: targetId,
      sourceNumber: source.number,
      targetNumber: target.number,
      items: source.items.length,
    });
  });
}

// --- split -------------------------------------------------------------------

export interface SplitSelection {
  itemId: string;
  quantity: number;
}

/**
 * Take some items (or part of a line) off a bill and put them on a new bill at the same
 * table, so each can be paid and invoiced separately. Safe to repeat with the same key.
 */
export async function splitOrder(
  ctx: TenantContext,
  orderId: string,
  selections: SplitSelection[],
  idempotencyKey: string,
) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) throw new DomainError("Something went wrong. Please try again.");

  // A double tap or a retry returns the bill the first tap made.
  const existing = await db.order.findUnique({ where: { businessId_idempotencyKey: { businessId, idempotencyKey } } });
  if (existing) {
    if (existing.branchId !== branchId) throw new DomainError("Something went wrong. Please try again.");
    return existing;
  }

  const wanted = selections.filter((s) => s.quantity > 0);
  if (wanted.length === 0) throw new DomainError("Choose at least one item to split off.");
  if (new Set(wanted.map((s) => s.itemId)).size !== wanted.length) throw new DomainError("Something went wrong. Please try again.");

  try {
    return await db.$transaction(async (tx) => {
      const order = await loadOpenOrder(tx, businessId, branchId, orderId);
      const active = order.items.filter((i) => i.status !== "CANCELLED");
      const byId = new Map(active.map((i) => [i.id, i]));

      let movedUnits = 0;
      for (const s of wanted) {
        const item = byId.get(s.itemId);
        if (!item) throw new DomainError("One of those items is not on this bill any more.");
        if (!Number.isInteger(s.quantity) || s.quantity < 1 || s.quantity > item.quantity) {
          throw new DomainError(`You can split off between 1 and ${item.quantity} of ${item.name}.`);
        }
        movedUnits += s.quantity;
      }
      const totalUnits = active.reduce((n, i) => n + i.quantity, 0);
      if (movedUnits >= totalUnits) {
        throw new DomainError("Leave at least one item on the original bill, or just pay it as it is.");
      }

      const { orderCounter } = await tx.business.update({
        where: { id: businessId },
        data: { orderCounter: { increment: 1 } },
        select: { orderCounter: true },
      });
      const created = await tx.order.create({
        data: {
          businessId,
          branchId,
          number: orderCounter,
          type: order.type,
          tableId: order.tableId,
          createdById: ctx.userId,
          idempotencyKey,
          splitFromId: order.id,
        },
      });

      for (const s of wanted) {
        const item = byId.get(s.itemId)!;
        if (s.quantity === item.quantity) {
          await tx.orderItem.update({ where: { id: item.id }, data: { orderId: created.id } });
        } else {
          await tx.orderItem.update({ where: { id: item.id }, data: { quantity: item.quantity - s.quantity } });
          await tx.orderItem.create({
            data: {
              businessId,
              orderId: created.id,
              menuItemId: item.menuItemId,
              name: item.name,
              unitPrice: item.unitPrice,
              quantity: s.quantity,
              note: item.note,
              complimentary: item.complimentary,
              status: item.status, // keeps its kitchen progress
              createdAt: item.createdAt,
              statusAt: item.statusAt,
              addOns: { create: item.addOns.map((a) => ({ businessId, name: a.name, price: a.price })) },
            },
          });
        }
      }
      await syncOrderStatus(tx, businessId, order.id);
      await syncOrderStatus(tx, businessId, created.id);
      await audit(tx, ctx, "order.split", "Order", order.id, {
        newOrder: created.number,
        items: wanted.map((s) => ({ name: byId.get(s.itemId)!.name, qty: s.quantity })),
      });
      return created;
    });
  } catch (e) {
    // Two identical taps raced: the loser returns the winner's bill.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await db.order.findUnique({ where: { businessId_idempotencyKey: { businessId, idempotencyKey } } });
      if (again) return again;
    }
    throw e;
  }
}

// --- split by item between guests --------------------------------------------

export interface SplitByItemInput {
  /** One entry per guest, in order. The first guest keeps this bill. */
  guests: { label: string }[];
  assignments: Assignment[];
  idempotencyKey: string;
}

const cleanLabel = (v: string, n: number) => v.replace(/\s+/g, " ").trim().slice(0, 30) || `Guest ${n + 1}`;

/**
 * Split a table's bill between guests, item by item. Every unit of every dish goes to one guest or is shared equally by several. The first
 * guest keeps this bill (its number, its customer and loyalty link); every other guest gets a new bill at the same table. Nothing is
 * paid here: each bill is paid and invoiced on its own afterwards, with its own service charge, VAT and discount. A shared dish becomes
 * equal-priced "1/3 share" lines that add up to its price, and only a dish already served can be shared (so the kitchen board never shows
 * one dish as several). Safe to repeat with the same key. Returns the bills, this one first.
 */
export async function splitByItem(ctx: TenantContext, orderId: string, input: SplitByItemInput) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey)) throw new DomainError("Something went wrong. Please try again.");
  const guestCount = input.guests.length;
  if (guestCount < 2 || guestCount > MAX_GUESTS) throw new DomainError(`Split between 2 and ${MAX_GUESTS} guests.`);
  const labels = input.guests.map((g, i) => cleanLabel(g.label, i));
  const keyFor = (i: number) => `${input.idempotencyKey}-g${i}`;

  // A double tap or a retry returns the bills the first tap made.
  const done = await db.order.findMany({ where: { businessId, branchId, idempotencyKey: { in: Array.from({ length: guestCount - 1 }, (_, i) => keyFor(i + 1)) } }, orderBy: { number: "asc" } });
  if (done.length > 0) {
    const first = await db.order.findFirst({ where: { id: orderId, businessId, branchId } });
    return { orders: [...(first ? [first] : []), ...done] };
  }

  try {
    return await db.$transaction(async (tx) => {
      const order = await loadOpenOrder(tx, businessId, branchId, orderId);
      if (order.type === "DELIVERY") throw new DomainError("A delivery bill cannot be split between guests.");
      const active = order.items.filter((i) => i.status !== "CANCELLED");
      if (active.length === 0) throw new DomainError("There is nothing on this bill to split.");
      const items: SplitItem[] = active.map((i) => ({ id: i.id, name: i.name, unitPrice: i.unitPrice, quantity: i.quantity }));
      let lines;
      try {
        lines = planSplit(items, input.assignments, guestCount);
      } catch (e) {
        if (e instanceof RangeError) throw new DomainError(e.message);
        throw e;
      }
      const byId = new Map(active.map((i) => [i.id, i]));
      for (const l of lines) {
        const item = byId.get(l.itemId)!;
        if (l.shareDen > 1 && item.status !== "SERVED") throw new DomainError(`${item.name} is still being made. Share it once it has been served.`);
      }

      // The bills: this one is guest 1; every other guest gets a new bill at the same table.
      const orderIds: string[] = [order.id];
      const created: { id: string; number: number }[] = [];
      for (let g = 1; g < guestCount; g++) {
        const { orderCounter } = await tx.business.update({ where: { id: businessId }, data: { orderCounter: { increment: 1 } }, select: { orderCounter: true } });
        const o = await tx.order.create({
          data: { businessId, branchId, number: orderCounter, type: order.type, tableId: order.tableId, createdById: ctx.userId, idempotencyKey: keyFor(g), splitFromId: order.id, label: labels[g] },
        });
        orderIds.push(o.id);
        created.push({ id: o.id, number: orderCounter });
      }
      await tx.order.update({ where: { id: order.id }, data: { label: labels[0] } });

      for (const item of active) {
        const mine = lines.filter((l) => l.itemId === item.id);
        for (let k = 0; k < mine.length; k++) {
          const l = mine[k]!;
          const name = shareName(item.name, l.shareDen);
          const scale = (price: number) => (l.shareDen > 1 ? Math.round(price / l.shareDen) : price);
          if (k === 0) {
            // The first piece is the original line, moved and re-priced if it is a share, so its kitchen history stays with it.
            await tx.orderItem.update({ where: { id: item.id }, data: { orderId: orderIds[l.guest], quantity: l.quantity, unitPrice: l.unitPrice, name, shareDen: l.shareDen } });
            if (l.shareDen > 1) for (const a of item.addOns) await tx.orderItemAddOn.update({ where: { id: a.id }, data: { price: scale(a.price) } });
          } else {
            await tx.orderItem.create({
              data: {
                businessId,
                orderId: orderIds[l.guest]!,
                menuItemId: item.menuItemId,
                name,
                unitPrice: l.unitPrice,
                quantity: l.quantity,
                note: item.note,
                complimentary: item.complimentary,
                status: item.status,
                createdAt: item.createdAt,
                statusAt: item.statusAt,
                printedAt: item.printedAt,
                shareDen: l.shareDen,
                addOns: { create: item.addOns.map((a) => ({ businessId, addOnId: a.addOnId, name: a.name, price: scale(a.price) })) },
              },
            });
          }
        }
      }
      for (const id of orderIds) await syncOrderStatus(tx, businessId, id);
      await audit(tx, ctx, "order.splitByItem", "Order", order.id, { guests: labels, newOrders: created.map((c) => c.number), lines: lines.length });
      const all = await tx.order.findMany({ where: { id: { in: orderIds }, businessId }, orderBy: { number: "asc" } });
      return { orders: all };
    });
  } catch (e) {
    // Two identical taps raced: the loser returns the winner's bills.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await db.order.findMany({ where: { businessId, branchId, idempotencyKey: { in: Array.from({ length: guestCount - 1 }, (_, i) => keyFor(i + 1)) } }, orderBy: { number: "asc" } });
      if (again.length > 0) {
        const first = await db.order.findFirst({ where: { id: orderId, businessId, branchId } });
        return { orders: [...(first ? [first] : []), ...again] };
      }
    }
    throw e;
  }
}
