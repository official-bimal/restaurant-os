import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { cleanPrinterName, cleanPrinterWidth, cleanRoutes, NO_STATION, ROUTE_KINDS, type RouteInput, type RouteRow } from "../routing";

/**
 * Printers and where each slip goes. A printer belongs to one branch; a small program next to it collects the jobs routed to it (by its id).
 * Only people who manage printing change any of this. Every query is filtered by business and branch.
 */

function need(ctx: TenantContext) {
  if (!can(ctx, "print.manage")) throw new DomainError("You do not have permission to change print settings.");
}

export async function listPrinters(ctx: TenantContext) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const [printers, waiting] = await Promise.all([
    db.printer.findMany({ where: { businessId, branchId }, orderBy: { name: "asc" } }),
    db.printJob.groupBy({ by: ["printerId"], where: { businessId, branchId, status: "QUEUED", printerId: { not: null } }, _count: { _all: true } }),
  ]);
  const w = new Map(waiting.map((x) => [x.printerId, x._count._all]));
  return printers.map((p) => ({ id: p.id, name: p.name, paperWidthMm: p.paperWidthMm, lastSeenAt: p.lastSeenAt, waiting: w.get(p.id) ?? 0 }));
}

export async function addPrinter(ctx: TenantContext, input: { name: string; paperWidthMm?: unknown }) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const name = cleanPrinterName(input.name);
  const paperWidthMm = cleanPrinterWidth(input.paperWidthMm);
  if (await db.printer.count({ where: { businessId, branchId } }) >= 20) throw new DomainError("A branch can have up to 20 printers.");
  if (await db.printer.findFirst({ where: { branchId, name: { equals: name, mode: "insensitive" } }, select: { id: true } })) throw new DomainError("This branch already has a printer with that name.");
  return db.$transaction(async (tx) => {
    const p = await tx.printer.create({ data: { businessId, branchId, name, paperWidthMm } });
    await audit(tx, ctx, "printer.add", "Printer", p.id, { name });
    return p.id;
  });
}

export async function updatePrinter(ctx: TenantContext, id: string, input: { name: string; paperWidthMm?: unknown }) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const name = cleanPrinterName(input.name);
  const paperWidthMm = cleanPrinterWidth(input.paperWidthMm);
  if (!(await db.printer.findFirst({ where: { id, businessId, branchId }, select: { id: true } }))) throw new DomainError("Printer not found.");
  if (await db.printer.findFirst({ where: { branchId, id: { not: id }, name: { equals: name, mode: "insensitive" } }, select: { id: true } })) throw new DomainError("This branch already has a printer with that name.");
  await db.$transaction(async (tx) => {
    await tx.printer.update({ where: { id }, data: { name, paperWidthMm } });
    await audit(tx, ctx, "printer.update", "Printer", id, { name });
  });
}

/** Removes the printer and its routes. Jobs still waiting for it are cancelled, so nothing prints on the wrong machine. */
export async function deletePrinter(ctx: TenantContext, id: string) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const p = await db.printer.findFirst({ where: { id, businessId, branchId }, select: { name: true } });
  if (!p) throw new DomainError("Printer not found.");
  await db.$transaction(async (tx) => {
    await tx.printJob.updateMany({ where: { businessId, printerId: id, status: { in: ["QUEUED", "FAILED"] } }, data: { status: "CANCELLED", error: "The printer was removed." } });
    await tx.printer.delete({ where: { id } });
    await audit(tx, ctx, "printer.delete", "Printer", id, { name: p.name });
  });
}

export async function getRoutes(ctx: TenantContext) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const [routes, stations] = await Promise.all([
    db.printRoute.findMany({ where: { businessId, branchId }, select: { kind: true, stationKey: true, printerId: true } }),
    db.station.findMany({ where: { businessId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { routes: routes as RouteRow[], stations };
}

/** Replace this branch's routes with the posted ones. A kind or station left on "none" has no route. */
export async function saveRoutes(ctx: TenantContext, input: RouteInput[]) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const [printers, stations] = await Promise.all([db.printer.findMany({ where: { businessId, branchId }, select: { id: true } }), db.station.findMany({ where: { businessId }, select: { id: true } })]);
  const rows = cleanRoutes(input, new Set(printers.map((p) => p.id)), new Set(stations.map((s) => s.id)));
  await db.$transaction(async (tx) => {
    await tx.printRoute.deleteMany({ where: { businessId, branchId } });
    if (rows.length) await tx.printRoute.createMany({ data: rows.map((r) => ({ ...r, businessId, branchId })) });
    await audit(tx, ctx, "printer.routes", "Branch", branchId, { routes: rows.length });
  });
}

/** Queue a test page on one printer (or on every printer of this branch). */
export async function queueTest(ctx: TenantContext, printerId?: string) {
  need(ctx);
  const { businessId, branchId } = scope(ctx);
  const printers = await db.printer.findMany({ where: { businessId, branchId, ...(printerId ? { id: printerId } : {}) }, select: { id: true } });
  if (printers.length === 0) throw new DomainError(printerId ? "Printer not found." : "Add a printer first.");
  // One waiting test page per printer is enough; pressing the button twice does not stack them.
  const waiting = await db.printJob.findMany({ where: { businessId, branchId, kind: "TEST", status: "QUEUED", printerId: { in: printers.map((p) => p.id) } }, select: { printerId: true } });
  const have = new Set(waiting.map((w) => w.printerId));
  const fresh = printers.filter((p) => !have.has(p.id));
  if (fresh.length) await db.printJob.createMany({ data: fresh.map((p) => ({ businessId, branchId, kind: "TEST", printerId: p.id, createdById: ctx.userId })) });
  return fresh.length;
}

export { NO_STATION, ROUTE_KINDS };
