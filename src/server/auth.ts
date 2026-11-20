import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { verifySessionToken, SESSION_COOKIE, BRANCH_COOKIE } from "@/server/session";
import type { Role } from "@/generated/prisma/enums";
import { can, isPermission, type Permission } from "@/server/permissions";

/** Everything a service needs. Built only here, from the database, never from client input. */
export interface TenantContext {
  userId: string;
  businessId: string;
  role: Role;
  /** Set when the person has a custom role: exactly what they may do (replaces what `role` gives). */
  permissions?: readonly Permission[];
  /** The branch this person is working in right now. Always one they are allowed to use. */
  branchId: string;
  /** Every branch they may use (all of them for owners and managers). */
  branchIds: string[];
}

/** TenantContext plus the sign-in state. Services only ever see the TenantContext part. */
export interface AuthContext extends TenantContext {
  mustChangePassword: boolean;
}

export async function getTenant(): Promise<AuthContext | null> {
  const store = await cookies();
  const claims = verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const user = await db.user.findUnique({
    where: { id: claims.userId },
    select: { sessionVersion: true, mustChangePassword: true },
  });
  // A changed or reset password bumps sessionVersion and ends every older session.
  if (!user || user.sessionVersion !== claims.sessionVersion) return null;
  const membership = await db.membership.findFirst({
    where: { userId: claims.userId },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) return null;

  // Which branches this person may use. The cookie only picks among them; it never grants access.
  const branches = await db.branch.findMany({
    where: { businessId: membership.businessId, active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const activeIds = new Set(branches.map((b) => b.id));
  const allowed = membership.allBranches
    ? branches.map((b) => b.id)
    : (await db.membershipBranch.findMany({ where: { membershipId: membership.id }, select: { branchId: true } }))
        .map((m) => m.branchId)
        .filter((id) => activeIds.has(id));
  if (allowed.length === 0) return null; // no branch to work in

  // A custom role replaces the built-in permissions; anything no longer valid is dropped.
  const custom = membership.customRoleId
    ? ((await db.customRole.findUnique({ where: { id: membership.customRoleId }, select: { permissions: true } }))?.permissions.filter(isPermission) ?? null)
    : null;

  const hint = store.get(BRANCH_COOKIE)?.value;
  const branchId = hint && allowed.includes(hint) ? hint : allowed[0];
  return {
    userId: claims.userId,
    businessId: membership.businessId,
    role: membership.role,
    permissions: custom ?? undefined,
    branchId,
    branchIds: allowed,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function requireTenant(
  permission?: Permission,
  options: { allowMustChange?: boolean } = {},
): Promise<AuthContext> {
  const ctx = await getTenant();
  if (!ctx) redirect("/login");
  // After an admin sets a temporary password, nothing else works until it is changed.
  if (ctx.mustChangePassword && !options.allowMustChange) redirect("/account");
  if (permission && !can(ctx, permission)) {
    // /orders needs no permission, so this can never loop.
    redirect(`/orders?error=${encodeURIComponent("You do not have access to that.")}`);
  }
  return ctx;
}
