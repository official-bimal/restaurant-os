import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";
import { bestDeal, localDayMinute, type DealDef, type DealLine } from "../deals";

/**
 * Automatic deals (happy hour, combos). Owners and managers set them up; the till applies the best one by itself when a bill qualifies.
 * Every query is filtered by businessId.
 */

type Db = Pick<Tx, "deal" | "menuItem">;

function need(ctx: TenantContext) {
  if (!can(ctx, "menu.manage")) throw new DomainError("You do not have permission to change deals.");
}

async function loadDeals(client: Db, businessId: string, branchId: string): Promise<DealDef[]> {
  const rows = await client.deal.findMany({ where: { businessId, active: true, OR: [{ branchId: null }, { branchId }] }, include: { items: true } });
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    days: d.days,
    startMinute: d.startMinute,
    endMinute: d.endMinute,
    percentBps: d.percentBps,
    comboPrice: d.comboPrice,
    items: d.items.map((i) => ({ menuItemId: i.menuItemId, categoryId: i.categoryId, quantity: i.quantity })),
  }));
}

/** The deal that applies to these order items right now, and what it takes off, or null. Works inside a transaction or outside one. */
export async function evaluateDeal(
  client: Db,
  businessId: string,
  branchId: string,
  timeZone: string,
  items: { menuItemId: string; unitPrice: number; quantity: number; complimentary: boolean }[],
  now = new Date(),
): Promise<{ id: string; name: string; amount: number } | null> {
  if (items.length === 0) return null;
  const deals = await loadDeals(client, businessId, branchId);
  if (deals.length === 0) return null;
  const cats = await client.menuItem.findMany({ where: { businessId, id: { in: [...new Set(items.map((i) => i.menuItemId))] } }, select: { id: true, categoryId: true } });
  const catOf = new Map(cats.map((c) => [c.id, c.categoryId]));
  const lines: DealLine[] = items.map((i) => ({ menuItemId: i.menuItemId, categoryId: catOf.get(i.menuItemId) ?? null, unitPrice: i.unitPrice, quantity: i.quantity, complimentary: i.complimentary }));
  const best = bestDeal(deals, lines, localDayMinute(now, timeZone));
  return best ? { id: best.deal.id, name: best.deal.name, amount: best.amount } : null;
}

// ---------------------------------------------------------------------------------------------------
// setting deals up

export async function listDeals(ctx: TenantContext) {
  need(ctx);
  return db.deal.findMany({ where: { businessId: ctx.businessId }, include: { items: true }, orderBy: [{ active: "desc" }, { createdAt: "desc" }] });
}

export interface DealInput {
  name: string;
  kind: string;
  days: number[];
  startMinute: number | null;
  endMinute: number | null;
  percentBps: number;
  comboPrice: number;
  branchId: string | null;
  items: { menuItemId: string | null; categoryId: string | null; quantity: number }[];
}

function clean(input: DealInput) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) throw new DomainError("Give the deal a name (60 characters at most).");
  if (input.kind !== "PERCENT_OFF" && input.kind !== "COMBO") throw new DomainError("Choose the kind of deal.");
  const days = [...new Set(input.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  const hasStart = input.startMinute !== null;
  if (hasStart !== (input.endMinute !== null)) throw new DomainError("Give both a start and an end time, or neither.");
  for (const m of [input.startMinute, input.endMinute]) if (m !== null && (!Number.isInteger(m) || m < 0 || m > 1439)) throw new DomainError("Choose valid times.");
  if (input.items.length > 12) throw new DomainError("A deal can list at most 12 dishes or categories.");
  const items = input.items.filter((i) => i.menuItemId || i.categoryId).map((i) => ({ ...i, quantity: Math.min(20, Math.max(1, Math.floor(i.quantity) || 1)) }));
  if (input.kind === "PERCENT_OFF") {
    if (!Number.isInteger(input.percentBps) || input.percentBps < 1 || input.percentBps > 10_000) throw new DomainError("The percentage must be between 0.01 and 100.");
  } else {
    if (!Number.isInteger(input.comboPrice) || input.comboPrice < 1 || input.comboPrice > 100_000_000) throw new DomainError("Enter the price of one bundle.");
    if (items.length < 1) throw new DomainError("A combo needs at least one dish or category in it.");
  }
  return { name, kind: input.kind as "PERCENT_OFF" | "COMBO", days: days.join(","), startMinute: input.startMinute, endMinute: input.endMinute, percentBps: input.kind === "PERCENT_OFF" ? input.percentBps : 0, comboPrice: input.kind === "COMBO" ? input.comboPrice : 0, items };
}

export async function saveDeal(ctx: TenantContext, input: DealInput) {
  need(ctx);
  const f = clean(input);
  return db.$transaction(async (tx) => {
    if (input.branchId && !(await tx.branch.findFirst({ where: { id: input.branchId, businessId: ctx.businessId } }))) throw new DomainError("Branch not found.");
    const itemIds = f.items.map((i) => i.menuItemId).filter(Boolean) as string[];
    const catIds = f.items.map((i) => i.categoryId).filter(Boolean) as string[];
    if (itemIds.length && (await tx.menuItem.count({ where: { businessId: ctx.businessId, id: { in: itemIds } } })) !== new Set(itemIds).size) throw new DomainError("A dish was not found.");
    if (catIds.length && (await tx.menuCategory.count({ where: { businessId: ctx.businessId, id: { in: catIds } } })) !== new Set(catIds).size) throw new DomainError("A category was not found.");
    const { items, ...fields } = f;
    const deal = await tx.deal.create({ data: { businessId: ctx.businessId, branchId: input.branchId, ...fields } });
    if (items.length) await tx.dealItem.createMany({ data: items.map((i) => ({ businessId: ctx.businessId, dealId: deal.id, menuItemId: i.menuItemId, categoryId: i.categoryId, quantity: i.quantity })) });
    await audit(tx, ctx, "deal.create", "Deal", deal.id, { name: f.name, kind: f.kind });
    return deal;
  });
}

export async function setDealActive(ctx: TenantContext, id: string, active: boolean) {
  need(ctx);
  await db.$transaction(async (tx) => {
    const r = await tx.deal.updateMany({ where: { id, businessId: ctx.businessId }, data: { active } });
    if (r.count === 0) throw new DomainError("Deal not found.");
    await audit(tx, ctx, active ? "deal.on" : "deal.off", "Deal", id);
  });
}

/** Deleting a deal does not change bills already made: they keep the deal's name and what it took off. */
export async function deleteDeal(ctx: TenantContext, id: string) {
  need(ctx);
  await db.$transaction(async (tx) => {
    const d = await tx.deal.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!d) throw new DomainError("Deal not found.");
    await tx.deal.delete({ where: { businessId_id: { businessId: ctx.businessId, id } } });
    await audit(tx, ctx, "deal.delete", "Deal", id, { name: d.name });
  });
}
