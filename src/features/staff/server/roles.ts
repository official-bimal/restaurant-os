import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { cleanRole, type RoleInput } from "../roles";

/**
 * Custom roles. Only the owner makes them and gives them to people, so a manager can never hand out more than a manager has.
 * Everything is filtered by ctx.businessId.
 */

function needOwner(ctx: TenantContext) {
  if (!can(ctx, "owner.control")) throw new DomainError("Only the owner can make roles.");
}

export async function listRoles(ctx: TenantContext) {
  needOwner(ctx);
  const rows = await db.customRole.findMany({ where: { businessId: ctx.businessId }, orderBy: { name: "asc" }, include: { _count: { select: { members: true } } } });
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, baseRole: r.baseRole, permissions: r.permissions, people: r._count.members }));
}

/** Roles to pick from when giving someone a role (the owner only). */
export async function roleChoices(ctx: TenantContext) {
  if (!can(ctx, "owner.control")) return [];
  const rows = await db.customRole.findMany({ where: { businessId: ctx.businessId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return rows;
}

export async function saveRole(ctx: TenantContext, id: string | null, input: RoleInput) {
  needOwner(ctx);
  const data = cleanRole(input);
  const clash = await db.customRole.findFirst({ where: { businessId: ctx.businessId, name: { equals: data.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
  if (clash) throw new DomainError("There is already a role with that name.");
  if (id && !(await db.customRole.findFirst({ where: { id, businessId: ctx.businessId }, select: { id: true } }))) throw new DomainError("Role not found.");
  return db.$transaction(async (tx) => {
    const saved = id
      ? await tx.customRole.update({ where: { id }, data })
      : await tx.customRole.create({ data: { ...data, businessId: ctx.businessId } });
    // Everyone with this role keeps the same kind of screen if the base changed.
    if (id) await tx.membership.updateMany({ where: { customRoleId: id, businessId: ctx.businessId }, data: { role: data.baseRole } });
    await audit(tx, ctx, id ? "role.update" : "role.create", "CustomRole", saved.id, { name: data.name, permissions: data.permissions.length });
    return saved.id;
  });
}

/** People who had the role go back to the built-in role it was based on. */
export async function deleteRole(ctx: TenantContext, id: string) {
  needOwner(ctx);
  const r = await db.customRole.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!r) throw new DomainError("Role not found.");
  await db.$transaction(async (tx) => {
    await tx.customRole.delete({ where: { id } });
    await audit(tx, ctx, "role.delete", "CustomRole", id, { name: r.name });
  });
}

/** Give someone a custom role (or take it away with null: they keep the built-in role it was based on). */
export async function assignRole(ctx: TenantContext, membershipId: string, roleId: string | null) {
  needOwner(ctx);
  const m = await db.membership.findFirst({ where: { id: membershipId, businessId: ctx.businessId }, include: { user: { select: { email: true } } } });
  if (!m) throw new DomainError("Staff member not found.");
  if (m.userId === ctx.userId) throw new DomainError("You cannot change your own role.");
  if (m.role === "OWNER") throw new DomainError("An owner cannot be given a custom role.");
  const role = roleId ? await db.customRole.findFirst({ where: { id: roleId, businessId: ctx.businessId } }) : null;
  if (roleId && !role) throw new DomainError("Role not found.");
  await db.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: m.id }, data: { customRoleId: role?.id ?? null, ...(role ? { role: role.baseRole } : {}) } });
    await audit(tx, ctx, "staff.customRole", "Membership", m.id, { email: m.user.email, role: role?.name ?? null });
  });
}
