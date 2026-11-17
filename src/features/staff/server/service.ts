import { hash, verify } from "@node-rs/argon2";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { canManageRole } from "@/server/permissions";
import { DomainError, WrongPasswordError } from "@/server/errors";
import { audit } from "@/server/audit";
import { assertAcceptablePassword, generateTempPassword } from "@/server/passwords";
import type { Role } from "@/generated/prisma/enums";

/**
 * Staff management. Every query is filtered by ctx.businessId. Rules enforced here,
 * not only in the screen: owners manage everyone, managers only roles below manager,
 * nobody manages their own account here, and the last owner can never be lost.
 */

export const ROLES: readonly Role[] = ["OWNER", "MANAGER", "CASHIER", "WAITER", "KITCHEN", "RIDER"];

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 80) throw new DomainError("Name must be 1 to 80 characters.");
  return name;
}

function cleanEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    throw new DomainError("Enter a valid email address.");
  }
  return email;
}

function needManage(ctx: TenantContext, target: Role) {
  if (!canManageRole(ctx.role, target)) {
    throw new DomainError("You do not have permission to manage that role.");
  }
}

async function ownTarget(ctx: TenantContext, membershipId: string) {
  const m = await db.membership.findFirst({
    where: { id: membershipId, businessId: ctx.businessId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!m) throw new DomainError("Staff member not found.");
  if (m.userId === ctx.userId) {
    throw new DomainError("You cannot do that to your own account here. Use My account for your password.");
  }
  return m;
}

async function assertNotLastOwner(businessId: string, membershipId: string) {
  const owners = await db.membership.count({ where: { businessId, role: "OWNER", id: { not: membershipId } } });
  if (owners === 0) throw new DomainError("A business must keep at least one owner.");
}

export async function listStaff(ctx: TenantContext) {
  if (!canManageRole(ctx.role, "KITCHEN")) throw new DomainError("You do not have permission to see staff.");
  const rows = await db.membership.findMany({
    where: { businessId: ctx.businessId },
    include: {
      user: { select: { id: true, name: true, email: true, mustChangePassword: true } },
      branches: { select: { branchId: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const rank = (r: Role) => ROLES.indexOf(r);
  return rows.sort((a, b) => rank(a.role) - rank(b.role));
}

export async function createStaff(ctx: TenantContext, input: { name: string; email: string; role: Role }) {
  needManage(ctx, input.role);
  const name = cleanName(input.name);
  const email = cleanEmail(input.email);

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  // One account belongs to one person. We never attach someone else's existing account.
  if (existing) throw new DomainError("That email is already in use.");

  const tempPassword = generateTempPassword();
  const passwordHash = await hash(tempPassword);
  await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, name, passwordHash, mustChangePassword: true } });
    const m = await tx.membership.create({ data: { userId: user.id, businessId: ctx.businessId, role: input.role } });
    await audit(tx, ctx, "staff.create", "Membership", m.id, { email, role: input.role });
  });
  return { email, tempPassword };
}

export async function changeRole(ctx: TenantContext, membershipId: string, newRole: Role) {
  const m = await ownTarget(ctx, membershipId);
  needManage(ctx, m.role);
  needManage(ctx, newRole);
  if (m.role === "OWNER" && newRole !== "OWNER") await assertNotLastOwner(ctx.businessId, m.id);
  await db.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: m.id }, data: { role: newRole } });
    await audit(tx, ctx, "staff.role", "Membership", m.id, { email: m.user.email, from: m.role, to: newRole });
  });
}

export async function removeStaff(ctx: TenantContext, membershipId: string) {
  const m = await ownTarget(ctx, membershipId);
  needManage(ctx, m.role);
  if (m.role === "OWNER") await assertNotLastOwner(ctx.businessId, m.id);
  await db.$transaction(async (tx) => {
    await tx.membership.delete({ where: { id: m.id } });
    const others = await tx.membership.count({ where: { userId: m.userId } });
    // Their access ends at once (auth re-reads the membership on every request).
    // The login itself goes too when it belonged to this business only.
    if (others === 0) await tx.user.delete({ where: { id: m.userId } });
    await audit(tx, ctx, "staff.remove", "Membership", m.id, { email: m.user.email, role: m.role });
  });
}

/** New temporary password; their current sessions end and they must choose their own. */
export async function resetStaffPassword(ctx: TenantContext, membershipId: string) {
  const m = await ownTarget(ctx, membershipId);
  needManage(ctx, m.role);
  const tempPassword = generateTempPassword();
  const passwordHash = await hash(tempPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: m.userId },
      data: { passwordHash, mustChangePassword: true, sessionVersion: { increment: 1 } },
    });
    await audit(tx, ctx, "staff.resetPassword", "Membership", m.id, { email: m.user.email });
  });
  return { email: m.user.email, tempPassword };
}

/** Returns the new session version so the caller can keep this browser signed in. */
export async function changeOwnPassword(
  ctx: TenantContext,
  input: { current: string; next: string },
): Promise<number> {
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  let ok = false;
  try {
    ok = await verify(user.passwordHash, input.current);
  } catch {
    ok = false;
  }
  if (!ok) throw new WrongPasswordError("Your current password is not correct.");
  assertAcceptablePassword(input.next, user.email);
  if (input.next === input.current) throw new DomainError("Choose a different password from the current one.");
  const passwordHash = await hash(input.next);
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    });
    await audit(tx, ctx, "account.passwordChange", "User", user.id);
    return u;
  });
  return updated.sessionVersion;
}
