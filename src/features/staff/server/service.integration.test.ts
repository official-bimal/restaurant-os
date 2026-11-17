import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verify } from "@node-rs/argon2";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import {
  changeOwnPassword,
  changeRole,
  createStaff,
  listStaff,
  removeStaff,
  resetStaffPassword,
} from "./service";

const stamp = Date.now();
const email = (n: string) => `${n}-${stamp}@it.test`;
let owner: TenantContext;
let ownerB: TenantContext;
let manager: TenantContext;
const businessIds: string[] = [];

async function makeOwner(name: string): Promise<TenantContext> {
  const user = await db.user.create({ data: { email: email(name), name, passwordHash: "x" } });
  const biz = await db.business.create({
    data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } },
  });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main branch" } });
  return { userId: user.id, businessId: biz.id, branchId: branch.id, branchIds: [branch.id], role: "OWNER" };
}

const membershipIdOf = async (ctx: TenantContext, mail: string) =>
  (await db.membership.findFirstOrThrow({ where: { businessId: ctx.businessId, user: { email: mail } } })).id;

beforeAll(async () => {
  owner = await makeOwner("itest-staff-a");
  ownerB = await makeOwner("itest-staff-b");
});

afterAll(async () => {
  const users = await db.user.findMany({ where: { email: { endsWith: `-${stamp}@it.test` } }, select: { id: true } });
  for (const id of businessIds) await db.business.delete({ where: { id } });
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await db.$disconnect();
});

describe("staff management", () => {
  it("creates staff with a temporary password that must be changed", async () => {
    const { tempPassword } = await createStaff(owner, { name: "  Sita  Rai ", email: ` ${email("sita").toUpperCase()} `, role: "MANAGER" });
    const user = await db.user.findUniqueOrThrow({ where: { email: email("sita") } });
    expect(user.name).toBe("Sita Rai");
    expect(user.mustChangePassword).toBe(true);
    expect(await verify(user.passwordHash, tempPassword)).toBe(true);
    expect(user.passwordHash).not.toContain(tempPassword);
    manager = { userId: user.id, businessId: owner.businessId, branchId: owner.branchId, branchIds: owner.branchIds, role: "MANAGER" };
  });

  it("refuses duplicate emails, including ones used in another business", async () => {
    await expect(createStaff(owner, { name: "X", email: email("sita"), role: "WAITER" })).rejects.toThrow("already in use");
    await expect(createStaff(ownerB, { name: "X", email: email("sita"), role: "WAITER" })).rejects.toThrow("already in use");
    await expect(createStaff(owner, { name: "X", email: "not-an-email", role: "WAITER" })).rejects.toThrow("valid email");
  });

  it("lets a manager manage only roles below manager", async () => {
    await createStaff(manager, { name: "Ram", email: email("ram"), role: "WAITER" });
    await expect(createStaff(manager, { name: "Y", email: email("y"), role: "MANAGER" })).rejects.toThrow("permission");
    await expect(createStaff(manager, { name: "Y", email: email("y2"), role: "OWNER" })).rejects.toThrow("permission");
    const ownerMembership = await db.membership.findFirstOrThrow({ where: { businessId: owner.businessId, role: "OWNER" } });
    await expect(changeRole(manager, ownerMembership.id, "WAITER")).rejects.toThrow(); // cannot touch the owner
    await expect(removeStaff(manager, ownerMembership.id)).rejects.toThrow();
    // and cannot promote a waiter into a manager
    await expect(changeRole(manager, await membershipIdOf(owner, email("ram")), "MANAGER")).rejects.toThrow("permission");
    await changeRole(manager, await membershipIdOf(owner, email("ram")), "CASHIER");
  });

  it("stops people changing or removing their own account", async () => {
    const own = await membershipIdOf(owner, email("itest-staff-a"));
    await expect(changeRole(owner, own, "WAITER")).rejects.toThrow("own account");
    await expect(removeStaff(owner, own)).rejects.toThrow("own account");
    await expect(resetStaffPassword(owner, own)).rejects.toThrow("own account");
  });

  it("keeps businesses apart", async () => {
    const mine = await membershipIdOf(owner, email("ram"));
    await expect(changeRole(ownerB, mine, "KITCHEN")).rejects.toThrow("not found");
    await expect(removeStaff(ownerB, mine)).rejects.toThrow("not found");
    await expect(resetStaffPassword(ownerB, mine)).rejects.toThrow("not found");
    expect((await listStaff(ownerB)).map((s) => s.user.email)).toEqual([email("itest-staff-b")]);
  });

  it("gives other roles no access", async () => {
    const waiter: TenantContext = { ...owner, role: "WAITER" };
    await expect(listStaff(waiter)).rejects.toThrow("permission");
    await expect(createStaff(waiter, { name: "Z", email: email("z"), role: "KITCHEN" })).rejects.toThrow("permission");
  });

  it("resets a password: new temporary one, must change, old sessions end", async () => {
    const id = await membershipIdOf(owner, email("ram"));
    const before = await db.user.findUniqueOrThrow({ where: { email: email("ram") } });
    const { tempPassword } = await resetStaffPassword(owner, id);
    const after = await db.user.findUniqueOrThrow({ where: { email: email("ram") } });
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(after.mustChangePassword).toBe(true);
    expect(await verify(after.passwordHash, tempPassword)).toBe(true);
  });

  it("changes your own password with the right checks", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: email("ram") } });
    const ram: TenantContext = { userId: user.id, businessId: owner.businessId, branchId: owner.branchId, branchIds: owner.branchIds, role: "CASHIER" };
    const temp = "temp-password-1";
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await (await import("@node-rs/argon2")).hash(temp) } });
    await expect(changeOwnPassword(ram, { current: "wrong-password!", next: "a-new-long-password" })).rejects.toThrow("current password");
    await expect(changeOwnPassword(ram, { current: temp, next: "short" })).rejects.toThrow("at least");
    await expect(changeOwnPassword(ram, { current: temp, next: temp })).rejects.toThrow("different");
    const version = await changeOwnPassword(ram, { current: temp, next: "a-new-long-password" });
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.mustChangePassword).toBe(false);
    expect(after.sessionVersion).toBe(version);
    expect(await verify(after.passwordHash, "a-new-long-password")).toBe(true);
  });

  it("removes staff and deletes a login that belonged only to this business", async () => {
    await removeStaff(owner, await membershipIdOf(owner, email("ram")));
    expect(await db.user.findUnique({ where: { email: email("ram") } })).toBeNull();
    const actions = await db.auditEvent.findMany({ where: { businessId: owner.businessId }, select: { action: true } });
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(["staff.create", "staff.role", "staff.resetPassword", "account.passwordChange", "staff.remove"]),
    );
  });
});
