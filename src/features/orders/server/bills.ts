import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { scope } from "@/server/branch";

/** Recent invoices, newest first, so staff can find one to look at or refund. */
export async function listRecentInvoices(ctx: TenantContext, number?: number) {
  if (!can(ctx, "bills.view")) throw new DomainError("You do not have permission to see bills.");
  return db.invoice.findMany({
    where: { ...scope(ctx), ...(number ? { number } : {}) },
    include: { order: { include: { table: { select: { label: true } } } }, payments: true, creditNotes: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
