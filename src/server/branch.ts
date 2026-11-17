import type { TenantContext } from "@/server/auth";

/**
 * The filter every branch-scoped query starts from: this business AND the branch the person is
 * working in. It throws instead of returning a partial filter, because Prisma treats an
 * undefined value as "no condition", which would silently show every branch.
 */
export function scope(ctx: Pick<TenantContext, "businessId" | "branchId">): { businessId: string; branchId: string } {
  if (!ctx.businessId || !ctx.branchId) throw new Error("No active branch for this request.");
  return { businessId: ctx.businessId, branchId: ctx.branchId };
}
