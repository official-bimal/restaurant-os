import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { setMultiBranch } from "./service";

const stamp = Date.now();
let owner: TenantContext;
let manager: TenantContext;
let businessId: string;
let second: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `mb-${stamp}@it.test`, name: "MB", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-mb-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const a = await db.branch.create({ data: { businessId, name: "Main" } });
  second = (await db.branch.create({ data: { businessId, name: "Lakeside", active: false } })).id;
  const base = { userId: user.id, businessId, branchId: a.id, branchIds: [a.id, second] };
  owner = { ...base, role: "OWNER" };
  manager = { ...base, role: "MANAGER" };
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

const flag = async () => (await db.business.findUniqueOrThrow({ where: { id: businessId } })).multiBranch;

describe("the several-branches setting", () => {
  it("starts off, and the owner turns it on and off", async () => {
    expect(await flag()).toBe(false);
    await setMultiBranch(owner, true);
    expect(await flag()).toBe(true);
    await setMultiBranch(owner, false);
    expect(await flag()).toBe(false);
  });

  it("cannot be turned off while more than one branch is active", async () => {
    await setMultiBranch(owner, true);
    await db.branch.update({ where: { id: second }, data: { active: true } });
    await expect(setMultiBranch(owner, false)).rejects.toThrow(/more than one active branch/);
    expect(await flag()).toBe(true);
    await db.branch.update({ where: { id: second }, data: { active: false } });
    await setMultiBranch(owner, false);
    expect(await flag()).toBe(false);
  });

  it("is the owner's to change", async () => {
    await expect(setMultiBranch(manager, true)).rejects.toThrow(/Only the owner/);
  });
});
