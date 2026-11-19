import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { setBranchWifi } from "@/features/branches/server/service";
import { lookupTable } from "./service";

const stamp = Date.now();
const businessIds: string[] = [];

interface World {
  owner: TenantContext;
  waiter: TenantContext;
  businessId: string;
  branchId: string;
  otherBranchId: string;
  token: string;
  otherToken: string;
}

async function makeWorld(name: string): Promise<World> {
  const user = await db.user.create({ data: { email: `${name}-${stamp}@it.test`, name, passwordHash: "x" } });
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const main = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  const second = await db.branch.create({ data: { businessId: biz.id, name: "Second" } });
  const area = await db.area.create({ data: { businessId: biz.id, branchId: main.id, name: "Hall" } });
  const area2 = await db.area.create({ data: { businessId: biz.id, branchId: second.id, name: "Hall" } });
  const t1 = await db.diningTable.create({ data: { businessId: biz.id, branchId: main.id, areaId: area.id, label: "T1" } });
  const t2 = await db.diningTable.create({ data: { businessId: biz.id, branchId: second.id, areaId: area2.id, label: "T1" } });
  const base = { businessId: biz.id, userId: user.id, branchId: main.id, branchIds: [main.id, second.id] };
  return { owner: { ...base, role: "OWNER" }, waiter: { ...base, role: "WAITER" }, businessId: biz.id, branchId: main.id, otherBranchId: second.id, token: t1.publicToken, otherToken: t2.publicToken };
}

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-wifi-a");
  b = await makeWorld("itest-wifi-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.diningTable.deleteMany({ where: { businessId: id } });
    await db.area.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

const wifi = { name: "Demo Cafe Guest", password: "welcome123", security: "WPA", hidden: false };

describe("guest Wi-Fi", () => {
  it("shows nothing until the owner sets it", async () => {
    expect((await lookupTable(a.token))!.wifi).toBeNull();
  });

  it("is shown on the table page of the branch it was set for, and only that branch", async () => {
    await setBranchWifi(a.owner, a.branchId, wifi);
    expect((await lookupTable(a.token))!.wifi).toEqual({ name: "Demo Cafe Guest", password: "welcome123", security: "WPA", hidden: false });
    expect((await lookupTable(a.otherToken))!.wifi).toBeNull(); // another branch of the same business has its own
    await setBranchWifi(a.owner, a.otherBranchId, { ...wifi, name: "Second Guest", password: "secondpass1", hidden: true });
    expect((await lookupTable(a.otherToken))!.wifi).toMatchObject({ name: "Second Guest", hidden: true });
    expect((await lookupTable(a.token))!.wifi!.name).toBe("Demo Cafe Guest");
  });

  it("an open network keeps no password", async () => {
    await setBranchWifi(a.owner, a.branchId, { name: "Open Guest", password: "ignored", security: "nopass", hidden: false });
    expect((await lookupTable(a.token))!.wifi).toEqual({ name: "Open Guest", password: "", security: "nopass", hidden: false });
  });

  it("a blank name takes the Wi-Fi off the page", async () => {
    await setBranchWifi(a.owner, a.branchId, wifi);
    await setBranchWifi(a.owner, a.branchId, { ...wifi, name: "  " });
    expect((await lookupTable(a.token))!.wifi).toBeNull();
    const row = await db.branch.findUniqueOrThrow({ where: { businessId_id: { businessId: a.businessId, id: a.branchId } } });
    expect(row).toMatchObject({ wifiName: null, wifiPassword: null });
  });

  it("refuses values that cannot work and says why, and changes nothing", async () => {
    await setBranchWifi(a.owner, a.branchId, wifi);
    await expect(setBranchWifi(a.owner, a.branchId, { ...wifi, password: "short" })).rejects.toThrow(/8 to 63/);
    await expect(setBranchWifi(a.owner, a.branchId, { ...wifi, name: "x".repeat(40) })).rejects.toThrow(/32/);
    await expect(setBranchWifi(a.owner, a.branchId, { ...wifi, security: "magic" })).rejects.toThrow(/secured/);
    expect((await lookupTable(a.token))!.wifi!.password).toBe("welcome123");
  });

  it("only the owner can set it, and only for their own business", async () => {
    await expect(setBranchWifi(a.waiter, a.branchId, wifi)).rejects.toThrow(/owner/);
    await expect(setBranchWifi(a.owner, b.branchId, { ...wifi, name: "Intruder Net" })).rejects.toThrow(/not found/);
    expect((await lookupTable(b.token))!.wifi).toBeNull();
  });

  it("the password is never written to the audit log", async () => {
    await setBranchWifi(a.owner, a.branchId, { ...wifi, password: "very-secret-pass-77" });
    const events = await db.auditEvent.findMany({ where: { businessId: a.businessId, action: "branch.wifi" } });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain("very-secret-pass-77");
  });

  it("settings edited by hand into something invalid are simply not shown", async () => {
    await db.branch.update({ where: { businessId_id: { businessId: a.businessId, id: a.branchId } }, data: { wifiName: "Broken", wifiPassword: "x", wifiSecurity: "WPA" } });
    expect((await lookupTable(a.token))!.wifi).toBeNull();
  });

  it("an unknown token still finds nothing", async () => {
    expect(await lookupTable("f".repeat(64))).toBeNull();
  });
});
