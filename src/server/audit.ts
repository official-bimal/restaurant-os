import type { Prisma } from "@/generated/prisma/client";
import type { TenantContext } from "@/server/auth";
import { publishLiveSoon } from "@/server/live";

export type Tx = Prisma.TransactionClient;

export async function audit(
  tx: Tx,
  ctx: TenantContext,
  action: string,
  entity: string,
  entityId: string,
  detail?: Prisma.InputJsonValue,
) {
  await tx.auditEvent.create({
    data: { businessId: ctx.businessId, userId: ctx.userId, action, entity, entityId, detail },
  });
  // Almost every change a person makes is audited, so this is where open pages learn that something changed.
  // It goes out a moment later, once the surrounding transaction has been committed.
  publishLiveSoon({ businessId: ctx.businessId, branchId: ctx.branchId, topic: action });
}
