import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can, isPermission } from "@/server/permissions";
import { changeRole } from "./service";
import { assignRole, deleteRole, listRoles, roleChoices, saveRole } from "./roles";

const stamp = Date.now();
const businessIds: string[] = [];

async function world(name: string) {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, mgr, waiter] = await Promise.all(["owner", "mgr", "wait"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  await db.membership.create({ data: { userId: mgr.id, businessId: biz.id, role: "MANAGER" } });
  const wm = await db.membership.create({ data: { userId: waiter.id, businessId: biz.id, role: "WAITER" } });
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, userId: owner.id, role: "OWNER" } as TenantContext,
    manager: { ...base, userId: mgr.id, role: "MANAGER" } as TenantContext,
    waiterId: waiter.id,
    waiterMembership: wm.id,
    base,
  };
}

let a: Awaited<ReturnType<typeof world>>;
let b: Awaited<ReturnType<typeof world>>;
const lead = { name: "Shift lead", color: "emerald", baseRole: "CASHIER", permissions: ["bill.checkout", "bill.refund", "order.create"] };

beforeAll(async () => {
  a = await world("itest-roles-a");
  b = await world("itest-roles-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("custom roles", () => {
  it("only the owner makes, lists and gives roles", async () => {
    await expect(saveRole(a.manager, null, lead)).rejects.toThrow(/owner/);
    await expect(listRoles(a.manager)).rejects.toThrow(/owner/);
    expect(await roleChoices(a.manager)).toEqual([]);
    const id = await saveRole(a.owner, null, lead);
    expect(await listRoles(a.owner)).toMatchObject([{ id, name: "Shift lead", baseRole: "CASHIER", people: 0 }]);
    await expect(saveRole(a.owner, null, { ...lead, name: "shift LEAD" })).rejects.toThrow(/already/);
    await expect(assignRole(a.manager, a.waiterMembership, id)).rejects.toThrow(/owner/);
  });

  it("is kept apart between businesses", async () => {
    expect(await listRoles(b.owner)).toEqual([]);
    const [r] = await listRoles(a.owner);
    await expect(assignRole(b.owner, a.waiterMembership, r!.id)).rejects.toThrow(/not found/);
    await expect(deleteRole(b.owner, r!.id)).rejects.toThrow(/not found/);
    await expect(saveRole(b.owner, r!.id, lead)).rejects.toThrow(/not found/);
  });

  it("gives a person exactly the ticked permissions and the base role's screens", async () => {
    const [r] = await listRoles(a.owner);
    await assignRole(a.owner, a.waiterMembership, r!.id);
    const m = await db.membership.findUniqueOrThrow({ where: { id: a.waiterMembership }, include: { customRole: true } });
    expect(m.role).toBe("CASHIER"); // the base role of the custom role
    const perms = m.customRole!.permissions.filter(isPermission);
    const ctx = { ...a.base, userId: a.waiterId, role: m.role, permissions: perms } as TenantContext;
    expect(can(ctx, "bill.refund")).toBe(true); // a plain cashier cannot refund
    expect(can(ctx, "customer.use")).toBe(false); // a plain cashier can attend to customers; this role was not given it
    expect(can(ctx, "owner.control")).toBe(false);
  });

  it("a change to the role reaches everyone who has it, and a built-in role takes it away", async () => {
    const [r] = await listRoles(a.owner);
    await saveRole(a.owner, r!.id, { ...lead, baseRole: "WAITER", permissions: ["order.create"] });
    expect((await db.membership.findUniqueOrThrow({ where: { id: a.waiterMembership } })).role).toBe("WAITER");
    expect((await listRoles(a.owner))[0]).toMatchObject({ people: 1, permissions: ["order.create"] });
    await changeRole(a.owner, a.waiterMembership, "KITCHEN");
    expect((await db.membership.findUniqueOrThrow({ where: { id: a.waiterMembership } })).customRoleId).toBeNull();
  });

  it("cannot go to an owner or to yourself, and deleting returns people to the base role", async () => {
    const [r] = await listRoles(a.owner);
    const ownerM = await db.membership.findFirstOrThrow({ where: { businessId: a.owner.businessId, role: "OWNER" } });
    await expect(assignRole(a.owner, ownerM.id, r!.id)).rejects.toThrow(/own role/);
    const mgrM = await db.membership.findFirstOrThrow({ where: { businessId: a.owner.businessId, role: "MANAGER" } });
    await assignRole(a.owner, mgrM.id, r!.id);
    await deleteRole(a.owner, r!.id);
    const after = await db.membership.findUniqueOrThrow({ where: { id: mgrM.id } });
    expect(after.customRoleId).toBeNull();
    expect(after.role).toBe("WAITER"); // it stays the base role it was given
    expect(await listRoles(a.owner)).toEqual([]);
    expect(await db.auditEvent.count({ where: { businessId: a.owner.businessId, action: { in: ["role.create", "role.update", "role.delete", "staff.customRole"] } } })).toBeGreaterThanOrEqual(5);
  });
});
