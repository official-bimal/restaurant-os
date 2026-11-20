import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";

/**
 * Invoice numbers for phones that have no connection. Each phone is given a block of consecutive numbers, taken from the
 * business's one invoice counter at that moment, so a number can never be handed out twice (not to another phone and not to a
 * bill made online). The phone uses its block in order. A number that is never used is recorded as a gap, never silently
 * skipped, so the whole series can always be accounted for: every number is either on an invoice or listed as a gap with a reason.
 *
 * Honest limit: bills made offline are numbered when they are made but reach the server later, so invoice numbers are not
 * always in time order across phones. Check with your accountant that this suits the rules that apply to you.
 */

export const BLOCK_SIZE = 50;
/** A phone with fewer unused numbers than this is given a fresh block when it connects. */
export const LOW_WATER = 15;
export const MAX_OPEN_BLOCKS = 20;

export interface DeviceBlock {
  id: string;
  from: number;
  to: number;
}

function needBill(ctx: TenantContext) {
  if (!can(ctx, "bill.checkout") || !can(ctx, "order.create")) throw new DomainError("You do not have permission to bill.");
}

function cleanDevice(deviceId: string): string {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(deviceId)) throw new DomainError("This phone could not be identified. Reload the page.");
  return deviceId;
}

/** Which numbers in a range are already on an invoice or recorded as a gap. */
async function takenNumbers(businessId: string, from: number, to: number): Promise<Set<number>> {
  const [inv, gaps] = await Promise.all([
    db.invoice.findMany({ where: { businessId, number: { gte: from, lte: to } }, select: { number: true } }),
    db.invoiceGap.findMany({ where: { businessId, number: { gte: from, lte: to } }, select: { number: true } }),
  ]);
  return new Set([...inv.map((i) => i.number), ...gaps.map((g) => g.number)]);
}

/**
 * The blocks this phone holds, topping up with a new block when it is running low. Returns every open block with the numbers
 * the server already has invoices for, so the phone can forget numbers that are used.
 */
export async function prepareDeviceBlocks(ctx: TenantContext, deviceIdRaw: string) {
  needBill(ctx);
  const deviceId = cleanDevice(deviceIdRaw);
  const { businessId, branchId } = scope(ctx);

  const open = await db.offlineNumberBlock.findMany({ where: { businessId, deviceId, status: "OPEN" }, orderBy: { fromNumber: "asc" } });
  const used = new Set<number>();
  let left = 0;
  for (const b of open) {
    const invoiced = await db.invoice.findMany({ where: { businessId, number: { gte: b.fromNumber, lte: b.toNumber } }, select: { number: true } });
    invoiced.forEach((i) => used.add(i.number));
    left += b.toNumber - b.fromNumber + 1 - invoiced.length;
  }

  if (left < LOW_WATER) {
    await db.$transaction(async (tx) => {
      // One at a time per business, so two phones asking together get separate, non-overlapping blocks.
      await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
      const openCount = await tx.offlineNumberBlock.count({ where: { businessId, status: "OPEN" } });
      if (openCount >= MAX_OPEN_BLOCKS) throw new DomainError("Too many phones hold invoice numbers. Ask the owner to close old blocks under Owner control.");
      const { invoiceCounter } = await tx.business.update({ where: { id: businessId }, data: { invoiceCounter: { increment: BLOCK_SIZE } }, select: { invoiceCounter: true } });
      const block = await tx.offlineNumberBlock.create({ data: { businessId, branchId, deviceId, userId: ctx.userId, fromNumber: invoiceCounter - BLOCK_SIZE + 1, toNumber: invoiceCounter } });
      await audit(tx, ctx, "offline.block", "OfflineNumberBlock", block.id, { from: block.fromNumber, to: block.toNumber });
    });
  }

  // A block whose numbers are all used is finished.
  const blocks = await db.offlineNumberBlock.findMany({ where: { businessId, deviceId, status: "OPEN" }, orderBy: { fromNumber: "asc" } });
  const result: DeviceBlock[] = [];
  const usedNow = new Set<number>();
  for (const b of blocks) {
    const taken = await takenNumbers(businessId, b.fromNumber, b.toNumber);
    taken.forEach((n) => usedNow.add(n));
    if (taken.size >= b.toNumber - b.fromNumber + 1) {
      await db.offlineNumberBlock.update({ where: { id: b.id }, data: { status: "CLOSED", closedAt: new Date() } });
      continue;
    }
    result.push({ id: b.id, from: b.fromNumber, to: b.toNumber });
  }
  return { blocks: result, used: [...usedNow, ...used].sort((a, b) => a - b) };
}

// --- the owner's view -----------------------------------------------------------------------

function needOwner(ctx: TenantContext) {
  if (!can(ctx, "owner.control")) throw new DomainError("Only the owner can manage offline invoice numbers.");
}

export async function listBlocks(ctx: TenantContext) {
  needOwner(ctx);
  const blocks = await db.offlineNumberBlock.findMany({ where: { businessId: ctx.businessId }, orderBy: { createdAt: "desc" }, take: 40 });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(blocks.map((b) => b.userId))] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const rows = [];
  for (const b of blocks) {
    const taken = await takenNumbers(ctx.businessId, b.fromNumber, b.toNumber);
    const invoiced = await db.invoice.count({ where: { businessId: ctx.businessId, number: { gte: b.fromNumber, lte: b.toNumber } } });
    rows.push({ ...b, user: names.get(b.userId) ?? "", size: b.toNumber - b.fromNumber + 1, invoiced, gaps: taken.size - invoiced });
  }
  return rows;
}

export async function listGaps(ctx: TenantContext) {
  needOwner(ctx);
  return db.invoiceGap.findMany({ where: { businessId: ctx.businessId }, orderBy: { number: "asc" }, take: 500 });
}

/**
 * Close a block: every number in it that has no invoice is recorded as a gap, with the reason. Use it when a phone is lost or
 * will not be used again. If that phone later does send a bill with one of those numbers, the gap is removed and the bill takes
 * its place, so a late bill is never lost.
 */
export async function closeBlock(ctx: TenantContext, blockId: string, reason: string) {
  needOwner(ctx);
  const why = reason.trim().replace(/\s+/g, " ").slice(0, 200);
  if (why.length < 3) throw new DomainError("Say why (a few words), for the record.");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OfflineNumberBlock" WHERE id = ${blockId} AND "businessId" = ${ctx.businessId} FOR UPDATE`;
    const b = await tx.offlineNumberBlock.findFirst({ where: { id: blockId, businessId: ctx.businessId } });
    if (!b) throw new DomainError("Block not found.");
    if (b.status === "CLOSED") throw new DomainError("That block is already closed.");
    const inv = await tx.invoice.findMany({ where: { businessId: ctx.businessId, number: { gte: b.fromNumber, lte: b.toNumber } }, select: { number: true } });
    const have = new Set(inv.map((i) => i.number));
    const gaps: { businessId: string; number: number; blockId: string; reason: string }[] = [];
    for (let n = b.fromNumber; n <= b.toNumber; n++) if (!have.has(n)) gaps.push({ businessId: ctx.businessId, number: n, blockId: b.id, reason: `Not used: ${why}` });
    if (gaps.length) await tx.invoiceGap.createMany({ data: gaps, skipDuplicates: true });
    await tx.offlineNumberBlock.update({ where: { id: b.id }, data: { status: "CLOSED", closedAt: new Date(), closedById: ctx.userId } });
    await audit(tx, ctx, "offline.blockClose", "OfflineNumberBlock", b.id, { from: b.fromNumber, to: b.toNumber, gaps: gaps.length, reason: why });
  });
}
