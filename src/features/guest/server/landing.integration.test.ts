import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { attachGuestCustomer, getGuestView, lookupTable, openSession } from "./service";

const stamp = Date.now();
let businessId = "";
let token = "";

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `itest-landing-${stamp}@it.test`, name: "landing", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: "itest-landing", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  const area = await db.area.create({ data: { businessId, branchId: branch.id, name: "Hall" } });
  const table = await db.diningTable.create({ data: { businessId, branchId: branch.id, areaId: area.id, label: "T1" } });
  token = table.publicToken;
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.customerOsLink.deleteMany({ where: { businessId } });
  await db.tableSession.deleteMany({ where: { businessId } });
  await db.customer.deleteMany({ where: { businessId } });
  await db.diningTable.deleteMany({ where: { businessId } });
  await db.area.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

const setLoyalty = (on: boolean) => db.business.update({ where: { id: businessId }, data: { loyaltyEnabled: on } });

describe("can a guest join the rewards from the first screen?", () => {
  it("yes when this app gives points, and no when it does not", async () => {
    await setLoyalty(true);
    expect((await lookupTable(token))!.rewards).toBe(true);
    await setLoyalty(false);
    expect((await lookupTable(token))!.rewards).toBe(false);
  });

  it("yes when Customer OS is connected and giving the points, even though this app's own points are off", async () => {
    await setLoyalty(false);
    await db.customerOsLink.upsert({ where: { businessId }, create: { businessId, baseUrl: "http://localhost:3100", keyEnc: "x", keyPrefix: "cos_live_aaaaa", enabled: true }, update: { enabled: true } });
    expect((await lookupTable(token))!.rewards).toBe(true);
    // Paused: nothing is being sent, so there are no points to join for.
    await db.customerOsLink.update({ where: { businessId }, data: { enabled: false } });
    expect((await lookupTable(token))!.rewards).toBe(false);
  });

  it("the guest's number can be added straight away, and the sitting then offers the points card", async () => {
    await setLoyalty(false);
    await db.customerOsLink.update({ where: { businessId }, data: { enabled: true } });
    const gc = await openSession(token);
    const r = await attachGuestCustomer(gc, { phone: "9841234567", marketingConsent: true });
    expect(r.maskedPhone).toMatch(/^\+977 98/);
    const view = await getGuestView(gc);
    expect(view.loyalty.enabled).toBe(true); // shown because Customer OS gives the points
    expect(view.loyalty.maskedPhone).toBe(r.maskedPhone);
    const customer = await db.customer.findFirstOrThrow({ where: { businessId } });
    expect(customer).toMatchObject({ phone: "+9779841234567", marketingConsent: true, consentVerified: false });
  });

  it("with no points anywhere the sitting does not offer the points card", async () => {
    await db.customerOsLink.delete({ where: { businessId } });
    await setLoyalty(false);
    const gc = await openSession(token);
    expect((await getGuestView(gc)).loyalty.enabled).toBe(false);
  });
});
