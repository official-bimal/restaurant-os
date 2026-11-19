import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { dayRange } from "@/lib/business-day";
import { describeAction, detailText } from "../activity";

/** Everything people did in the business (every audited change), for the owner. Newest first, at most 300. */
export async function getActivity(ctx: TenantContext, f: { from: string; to: string; userId?: string; search?: string }) {
  if (!can(ctx.role, "owner.control")) throw new DomainError("Only the owner can see the activity log.");
  const biz = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { timezone: true } });
  const { start } = dayRange(f.from, biz.timezone);
  const { end } = dayRange(f.to, biz.timezone);
  const search = f.search?.trim().slice(0, 40);
  const [events, staff] = await Promise.all([
    db.auditEvent.findMany({
      where: {
        businessId: ctx.businessId,
        createdAt: { gte: start, lt: end },
        ...(f.userId ? { userId: f.userId } : {}),
        ...(search ? { OR: [{ action: { contains: search, mode: "insensitive" } }, { entity: { contains: search, mode: "insensitive" } }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    db.membership.findMany({ where: { businessId: ctx.businessId }, select: { user: { select: { id: true, name: true } } } }),
  ]);
  const names = new Map(staff.map((m) => [m.user.id, m.user.name]));
  return {
    staff: staff.map((m) => ({ id: m.user.id, name: m.user.name })),
    events: events.map((e) => ({ id: e.id, at: e.createdAt, who: e.userId ? (names.get(e.userId) ?? "Former staff") : "System", what: describeAction(e.action), code: e.action, detail: detailText(e.detail) })),
  };
}
