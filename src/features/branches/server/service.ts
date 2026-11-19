import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { Prisma } from "@/generated/prisma/client";
import { parseLocation } from "@/features/delivery/geo";
import { cleanWifi, WifiError } from "@/features/guest/wifi";

/**
 * Branches (outlets). Owner only. Every query is filtered by businessId. A branch is never
 * deleted: it is switched off, which keeps its bills and reports readable.
 */

function needManage(ctx: TenantContext) {
  if (!can(ctx.role, "branch.manage")) throw new DomainError("Only the owner can manage branches.");
}

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 60) throw new DomainError("Branch name must be 1 to 60 characters.");
  return name;
}

function cleanAddress(value: string | undefined): string | null {
  const a = (value ?? "").trim().replace(/\s+/g, " ");
  if (a.length > 200) throw new DomainError("The address is too long (200 characters at most).");
  return a || null;
}

/** The branches this person may work in (for the switcher). */
export async function listMyBranches(ctx: TenantContext) {
  return db.branch.findMany({
    where: { businessId: ctx.businessId, id: { in: ctx.branchIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
}

export async function listBranches(ctx: TenantContext) {
  needManage(ctx);
  return db.branch.findMany({
    where: { businessId: ctx.businessId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { tables: true } } },
  });
}

export async function createBranch(ctx: TenantContext, input: { name: string; address?: string }) {
  needManage(ctx);
  const name = cleanName(input.name);
  const address = cleanAddress(input.address);
  try {
    return await db.$transaction(async (tx) => {
      const branch = await tx.branch.create({ data: { businessId: ctx.businessId, name, address } });
      await audit(tx, ctx, "branch.create", "Branch", branch.id, { name });
      return branch;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new DomainError("You already have a branch with that name.");
    }
    throw e;
  }
}

export async function updateBranch(ctx: TenantContext, id: string, input: { name: string; address?: string }) {
  needManage(ctx);
  const name = cleanName(input.name);
  const address = cleanAddress(input.address);
  try {
    await db.$transaction(async (tx) => {
      const r = await tx.branch.updateMany({ where: { id, businessId: ctx.businessId }, data: { name, address } });
      if (r.count === 0) throw new DomainError("Branch not found.");
      await audit(tx, ctx, "branch.update", "Branch", id, { name });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new DomainError("You already have a branch with that name.");
    }
    throw e;
  }
}

/** Switch a branch off or back on. The last active branch cannot be switched off, nor one with open bills. */
export async function setBranchActive(ctx: TenantContext, id: string, active: boolean) {
  needManage(ctx);
  await db.$transaction(async (tx) => {
    const branch = await tx.branch.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!branch) throw new DomainError("Branch not found.");
    if (!active) {
      const others = await tx.branch.count({ where: { businessId: ctx.businessId, active: true, id: { not: id } } });
      if (others === 0) throw new DomainError("A business needs at least one active branch.");
      const open = await tx.order.count({
        where: { businessId: ctx.businessId, branchId: id, status: { in: ["OPEN", "SERVED"] } },
      });
      if (open > 0) throw new DomainError(`${open} bill${open === 1 ? " is" : "s are"} still open there. Pay or cancel ${open === 1 ? "it" : "them"} first.`);
    }
    await tx.branch.update({ where: { businessId_id: { businessId: ctx.businessId, id } }, data: { active } });
    await audit(tx, ctx, active ? "branch.activate" : "branch.deactivate", "Branch", id, { name: branch.name });
  });
}

/** Which branches may this team member work in? */
export async function setStaffBranches(
  ctx: TenantContext,
  membershipId: string,
  input: { allBranches: boolean; branchIds: string[] },
) {
  needManage(ctx);
  await db.$transaction(async (tx) => {
    const m = await tx.membership.findFirst({
      where: { id: membershipId, businessId: ctx.businessId },
      include: { user: { select: { email: true } } },
    });
    if (!m) throw new DomainError("Staff member not found.");
    if (m.userId === ctx.userId) throw new DomainError("You cannot change your own branch access.");

    const ids = [...new Set(input.branchIds)];
    if (!input.allBranches) {
      if (ids.length === 0) throw new DomainError("Choose at least one branch, or give access to all.");
      const valid = await tx.branch.count({ where: { businessId: ctx.businessId, id: { in: ids }, active: true } });
      if (valid !== ids.length) throw new DomainError("One of those branches is not available.");
    }
    await tx.membershipBranch.deleteMany({ where: { membershipId, businessId: ctx.businessId } });
    if (!input.allBranches) {
      await tx.membershipBranch.createMany({
        data: ids.map((branchId) => ({ membershipId, branchId, businessId: ctx.businessId })),
      });
    }
    await tx.membership.update({ where: { id: membershipId }, data: { allBranches: input.allBranches } });
    await audit(tx, ctx, "staff.branches", "Membership", membershipId, {
      email: m.user.email,
      allBranches: input.allBranches,
      branchIds: input.allBranches ? [] : ids,
    });
  });
}

/** Where the branch is (coordinates or a map link), used for automatic delivery distance and the map. Blank clears it. */
export async function setBranchLocation(ctx: TenantContext, id: string, text: string) {
  needManage(ctx);
  const clean = text.trim();
  const point = clean ? parseLocation(clean) : null;
  if (clean && !point) throw new DomainError("Could not read that location. Paste coordinates like 27.7172, 85.324 or a link from a map app.");
  await db.$transaction(async (tx) => {
    const r = await tx.branch.updateMany({
      where: { id, businessId: ctx.businessId },
      data: { latitude: point?.lat ?? null, longitude: point?.lng ?? null },
    });
    if (r.count === 0) throw new DomainError("Branch not found.");
    await audit(tx, ctx, "branch.location", "Branch", id, { set: !!point });
  });
}

/**
 * The Wi-Fi guests may use, shown on that branch's table QR page. A blank network name clears it (nothing is shown). The password
 * is kept as typed (it is shown to guests, so it is not a secret from them) and is never written to the audit log.
 */
export async function setBranchWifi(ctx: TenantContext, id: string, input: { name: string; password: string; security: string; hidden: boolean }) {
  needManage(ctx);
  let wifi;
  try {
    wifi = cleanWifi(input);
  } catch (e) {
    if (e instanceof WifiError) throw new DomainError(e.message);
    throw e;
  }
  await db.$transaction(async (tx) => {
    const r = await tx.branch.updateMany({
      where: { id, businessId: ctx.businessId },
      data: { wifiName: wifi?.name ?? null, wifiPassword: wifi?.password ?? null, wifiSecurity: wifi?.security ?? "WPA", wifiHidden: wifi?.hidden ?? false },
    });
    if (r.count === 0) throw new DomainError("Branch not found.");
    await audit(tx, ctx, "branch.wifi", "Branch", id, { set: !!wifi });
  });
}
