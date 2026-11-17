import type { Tx } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { localDate } from "@/lib/business-day";

/**
 * Refuse to post anything dated today if the owner has already closed today. Payments and
 * refunds are dated "now", so a closed day would otherwise quietly change after its count.
 */
export async function assertDayOpen(tx: Tx, businessId: string, branchId: string, now = new Date()) {
  const business = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } });
  const date = localDate(now, business.timezone);
  const closed = await tx.dayClose.findUnique({ where: { branchId_date: { branchId, date } }, select: { id: true } });
  if (closed) {
    throw new DomainError("Today has already been closed for this branch. Ask the owner to reopen the day to take more payments.");
  }
}
