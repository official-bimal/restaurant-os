import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";
import { cardState, countStamps, qualifies, type CardState, type ProgramItemDef } from "../stamps";

/**
 * Stamp cards. Owners and managers set the programmes up; at the till, a customer who has been confirmed in person can use a free dish when their
 * card is full. Stamps are worked out from the customer's paid bills (a bill that was fully refunded earns none) and the free dishes already given.
 * Every query is filtered by businessId.
 */

type Client = Pick<Tx, "stampProgram" | "stampRedemption" | "orderItem" | "menuItem" | "creditNote">;

function needManage(ctx: TenantContext) {
  if (!can(ctx, "campaign.manage")) throw new DomainError("You do not have permission to change stamp cards.");
}

export interface ProgramStatus {
  programId: string;
  name: string;
  target: number;
  items: ProgramItemDef[];
  card: CardState;
}

/** Every active programme with this customer's progress. */
export async function stampStatus(client: Client, businessId: string, customerId: string): Promise<ProgramStatus[]> {
  const programs = await client.stampProgram.findMany({ where: { businessId, active: true }, include: { items: true }, orderBy: { createdAt: "asc" } });
  if (programs.length === 0) return [];
  const [bought, given] = await Promise.all([
    client.orderItem.findMany({
      where: { businessId, status: { not: "CANCELLED" }, order: { invoice: { is: { customerId, creditNotes: { none: { partial: false } } } } } },
      select: { menuItemId: true, quantity: true, complimentary: true, menuItem: { select: { categoryId: true } } },
    }),
    client.stampRedemption.findMany({ where: { businessId, customerId }, select: { programId: true, invoiceId: true } }),
  ]);
  // A free dish on a bill that was then refunded in full is given back: the card has it again.
  const refunded = new Set(
    given.length ? (await client.creditNote.findMany({ where: { businessId, partial: false, invoiceId: { in: given.map((g) => g.invoiceId) } }, select: { invoiceId: true } })).map((c) => c.invoiceId) : [],
  );
  const redeemed = new Map<string, number>();
  for (const g of given) if (!refunded.has(g.invoiceId)) redeemed.set(g.programId, (redeemed.get(g.programId) ?? 0) + 1);
  const units = bought.map((b) => ({ menuItemId: b.menuItemId, categoryId: b.menuItem.categoryId, quantity: b.quantity, complimentary: b.complimentary }));
  return programs.map((p) => {
    const items = p.items.map((i) => ({ menuItemId: i.menuItemId, categoryId: i.categoryId }));
    return { programId: p.id, name: p.name, target: p.target, items, card: cardState(countStamps(items, units), redeemed.get(p.id) ?? 0, p.target) };
  });
}

/** For an order's bill screen: the customer's cards, and which dishes on the order could be the free one. Needs a confirmed customer. */
export async function getStampOptions(ctx: TenantContext, orderId: string) {
  if (!can(ctx, "customer.use")) return null;
  const { businessId, branchId } = scope(ctx);
  const order = await db.order.findFirst({
    where: { id: orderId, businessId, branchId },
    select: { customerId: true, customerConfirmed: true, items: { where: { status: { not: "CANCELLED" }, complimentary: false, unitPrice: { gt: 0 } }, select: { id: true, name: true, unitPrice: true, menuItemId: true, menuItem: { select: { categoryId: true } } } } },
  });
  if (!order?.customerId) return null;
  const programs = await stampStatus(db, businessId, order.customerId);
  return {
    confirmed: order.customerConfirmed,
    programs: programs.map((p) => ({
      programId: p.programId,
      name: p.name,
      target: p.target,
      card: p.card,
      eligible: order.items.filter((i) => qualifies(p.items, { menuItemId: i.menuItemId, categoryId: i.menuItem.categoryId })).map((i) => ({ orderItemId: i.id, name: i.name, unitPrice: i.unitPrice })),
    })),
  };
}

export interface StampUse {
  programId: string;
  customerId: string;
  itemName: string;
  valueMinor: number;
}

/**
 * Checks that a free dish can be given on this order, and what it is worth. Throws a DomainError when it cannot. The dish must be on the order,
 * paid for (not already free) and one the programme covers; the customer must have a full card and have been confirmed in person.
 */
export async function resolveStamp(
  client: Client,
  businessId: string,
  order: { id: string; customerId: string | null; customerConfirmed: boolean },
  choice: { programId: string; orderItemId?: string },
): Promise<StampUse> {
  if (!order.customerId) throw new DomainError("Add a customer to the order to use a stamp card.");
  if (!order.customerConfirmed) throw new DomainError("Confirm in person that this is the customer before using their stamp card.");
  const status = (await stampStatus(client, businessId, order.customerId)).find((p) => p.programId === choice.programId);
  if (!status) throw new DomainError("That stamp card is not available.");
  if (status.card.available < 1) throw new DomainError(`The ${status.name} card is not full yet: ${status.card.toGo} more to go.`);
  const items = await client.orderItem.findMany({
    where: { businessId, status: { not: "CANCELLED" }, complimentary: false, unitPrice: { gt: 0 }, ...(choice.orderItemId ? { id: choice.orderItemId } : {}), orderId: order.id },
    select: { id: true, name: true, unitPrice: true, menuItemId: true, order: { select: { id: true } }, menuItem: { select: { categoryId: true } } },
    orderBy: { createdAt: "asc" },
  });
  const pick = items.find((i) => qualifies(status.items, { menuItemId: i.menuItemId, categoryId: i.menuItem.categoryId }));
  if (!pick) throw new DomainError("Choose a dish on the bill that this card covers.");
  return { programId: status.programId, customerId: order.customerId, itemName: pick.name, valueMinor: pick.unitPrice };
}

// ---------------------------------------------------------------------------------------------------
// setting programmes up

export async function listStampPrograms(ctx: TenantContext) {
  needManage(ctx);
  const rows = await db.stampProgram.findMany({ where: { businessId: ctx.businessId }, include: { items: true, _count: { select: { redemptions: true } } }, orderBy: [{ active: "desc" }, { createdAt: "desc" }] });
  return rows;
}

export async function saveStampProgram(ctx: TenantContext, input: { name: string; target: number; items: { menuItemId: string | null; categoryId: string | null }[] }) {
  needManage(ctx);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) throw new DomainError("Give the card a name (60 characters at most).");
  if (!Number.isInteger(input.target) || input.target < 2 || input.target > 50) throw new DomainError("A card needs between 2 and 50 stamps.");
  const items = input.items.filter((i) => i.menuItemId || i.categoryId).slice(0, 12);
  return db.$transaction(async (tx) => {
    const itemIds = items.map((i) => i.menuItemId).filter(Boolean) as string[];
    const catIds = items.map((i) => i.categoryId).filter(Boolean) as string[];
    if (itemIds.length && (await tx.menuItem.count({ where: { businessId: ctx.businessId, id: { in: itemIds } } })) !== new Set(itemIds).size) throw new DomainError("A dish was not found.");
    if (catIds.length && (await tx.menuCategory.count({ where: { businessId: ctx.businessId, id: { in: catIds } } })) !== new Set(catIds).size) throw new DomainError("A category was not found.");
    const p = await tx.stampProgram.create({ data: { businessId: ctx.businessId, name, target: input.target } });
    if (items.length) await tx.stampProgramItem.createMany({ data: items.map((i) => ({ businessId: ctx.businessId, programId: p.id, menuItemId: i.menuItemId, categoryId: i.categoryId })) });
    await audit(tx, ctx, "stamps.create", "StampProgram", p.id, { name, target: input.target });
    return p;
  });
}

export async function setStampProgramActive(ctx: TenantContext, id: string, active: boolean) {
  needManage(ctx);
  await db.$transaction(async (tx) => {
    const r = await tx.stampProgram.updateMany({ where: { id, businessId: ctx.businessId }, data: { active } });
    if (r.count === 0) throw new DomainError("Stamp card not found.");
    await audit(tx, ctx, active ? "stamps.on" : "stamps.off", "StampProgram", id);
  });
}

/** A card that has been used cannot be deleted (the record of free dishes stays); switch it off instead. */
export async function deleteStampProgram(ctx: TenantContext, id: string) {
  needManage(ctx);
  await db.$transaction(async (tx) => {
    const p = await tx.stampProgram.findFirst({ where: { id, businessId: ctx.businessId }, include: { _count: { select: { redemptions: true } } } });
    if (!p) throw new DomainError("Stamp card not found.");
    if (p._count.redemptions > 0) throw new DomainError("Free dishes have been given on this card, so it is kept for the record. Switch it off instead.");
    await tx.stampProgram.delete({ where: { businessId_id: { businessId: ctx.businessId, id } } });
    await audit(tx, ctx, "stamps.delete", "StampProgram", id, { name: p.name });
  });
}
