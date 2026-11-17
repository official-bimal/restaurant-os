import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { addItem, checkout, createOrder, previewBill } from "@/features/orders/server/service";
import { attachCustomerToOrder, deleteCustomer } from "@/features/loyalty/server/customers";
import {
  createCampaign,
  exportQueued,
  getCampaign,
  listCampaigns,
  markSent,
  prepareCampaign,
  recordOptOut,
  segmentCounts,
} from "./service";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;
let phoneSeq = 100_000;
const nextPhone = () => `9811${String(++phoneSeq).padStart(6, "0")}`; // local form, a valid Nepal mobile range
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

interface World {
  owner: TenantContext;
  manager: TenantContext;
  cashier: TenantContext;
  waiter: TenantContext;
  areaId: string;
  momo: string;
  name: string;
}

async function makeWorld(name: string): Promise<World> {
  const user = await db.user.create({ data: { email: `${name}-${stamp}@it.test`, name, passwordHash: "x" } });
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main branch" } });
  businessIds.push(biz.id);
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", price: 20_000 } });
  const base = { userId: user.id, businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, role: "OWNER" },
    manager: { ...base, role: "MANAGER" },
    cashier: { ...base, role: "CASHIER" },
    waiter: { ...base, role: "WAITER" },
    areaId: area.id,
    momo: momo.id,
    name,
  };
}

/** A customer in a chosen state, written straight to the database. */
async function customer(
  w: World,
  o: { name?: string | null; visits: number; daysAgo: number | null; consent?: "verified" | "unverified" | "none"; spend?: number },
) {
  const consent = o.consent ?? "verified";
  const local = nextPhone();
  const c = await db.customer.create({
    data: {
      businessId: w.owner.businessId,
      phone: `+977${local}`,
      name: o.name === undefined ? "Test Person" : o.name,
      visitCount: o.visits,
      totalSpend: o.spend ?? o.visits * 50_000,
      lastVisitAt: o.daysAgo === null ? null : ago(o.daysAgo),
      marketingConsent: consent !== "none",
      consentVerified: consent === "verified",
    },
  });
  return { ...c, local };
}

async function payFor(w: World, localPhone: string) {
  const table = await db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.owner.branchId, areaId: w.areaId, label: `T${uid()}` } });
  const order = await createOrder(w.owner, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
  await addItem(w.owner, order.id, { menuItemId: w.momo, quantity: 2 });
  await attachCustomerToOrder(w.cashier, order.id, { phone: localPhone });
  const t = await previewBill(w.owner, order.id, { kind: "none" });
  return checkout(w.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
}

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-camp-a");
  b = await makeWorld("itest-camp-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.campaignMessage.deleteMany({ where: { businessId: id } });
    await db.campaign.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.customer.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

const input = (over: Partial<Parameters<typeof createCampaign>[1]> = {}) => ({
  name: "Win back",
  segment: "AT_RISK",
  template: "Hi {name}, we miss you at {business}! Come back in {days} days for {points} bonus points.",
  offerPoints: 50,
  offerDays: 14,
  ...over,
});

describe("segments and who may run campaigns", () => {
  it("counts customers per segment and how many of them can be messaged", async () => {
    await customer(a, { visits: 1, daysAgo: 3 }); // NEW
    await customer(a, { visits: 1, daysAgo: 4, consent: "none" }); // NEW, not reachable
    await customer(a, { visits: 3, daysAgo: 45 }); // AT_RISK
    await customer(a, { visits: 3, daysAgo: 200 }); // LOST
    await customer(a, { visits: 0, daysAgo: null }); // NO_VISIT
    const counts = await segmentCounts(a.manager);
    expect(counts.NEW).toEqual({ total: 2, reachable: 1 });
    expect(counts.AT_RISK.total).toBe(1);
    expect(counts.LOST.total).toBe(1);
    expect(counts.NO_VISIT.total).toBe(1);
    expect((await segmentCounts(b.owner)).NEW.total).toBe(0); // another business sees none of it
  });

  it("is limited to owner and manager", async () => {
    for (const who of [a.cashier, a.waiter]) {
      await expect(segmentCounts(who)).rejects.toThrow("permission");
      await expect(listCampaigns(who)).rejects.toThrow("permission");
      await expect(createCampaign(who, input())).rejects.toThrow("permission");
    }
    await expect(createCampaign(a.manager, input())).resolves.toBeTruthy();
  });

  it("validates a campaign", async () => {
    await expect(createCampaign(a.owner, input({ name: " " }))).rejects.toThrow("Name");
    await expect(createCampaign(a.owner, input({ segment: "EVERYONE" }))).rejects.toThrow("who the message is for");
    await expect(createCampaign(a.owner, input({ template: "Hi {nmae}!" }))).rejects.toThrow("placeholder");
    await expect(createCampaign(a.owner, input({ template: "x".repeat(400) }))).rejects.toThrow("under 320");
    await expect(createCampaign(a.owner, input({ offerPoints: -1 }))).rejects.toThrow("Bonus points");
    await expect(createCampaign(a.owner, input({ offerDays: 0 }))).rejects.toThrow("between 1 and 90");
    await expect(createCampaign(a.owner, input({ offerDays: 91 }))).rejects.toThrow("between 1 and 90");
  });
});

describe("preparing a campaign", () => {
  it("includes only the segment, only confirmed consent, and writes each person's text", async () => {
    const w = await makeWorld("itest-camp-prep");
    const good = await customer(w, { name: "Sita Rai", visits: 2, daysAgo: 40 });
    await customer(w, { visits: 2, daysAgo: 41, consent: "unverified" }); // ticked on a phone, not confirmed
    await customer(w, { visits: 2, daysAgo: 42, consent: "none" });
    await customer(w, { visits: 2, daysAgo: 3 }); // wrong segment
    const noName = await customer(w, { name: null, visits: 2, daysAgo: 43 });
    const c = await createCampaign(w.owner, input());

    const res = await prepareCampaign(w.manager, c.id);
    expect(res).toEqual({ inSegment: 4, prepared: 2, noConsent: 2, tooSoon: 0 });
    const msgs = await db.campaignMessage.findMany({ where: { campaignId: c.id } });
    expect(msgs).toHaveLength(2);
    const goodMsg = msgs.find((m) => m.customerId === good.id)!;
    expect(goodMsg.text).toBe("Hi Sita, we miss you at itest-camp-prep! Come back in 14 days for 50 bonus points.");
    expect(goodMsg).toMatchObject({ status: "QUEUED", offerPoints: 50, sentAt: null });
    expect(msgs.find((m) => m.customerId === noName.id)!.text).toContain("Hi there,");
    expect(JSON.stringify(msgs)).not.toContain("+977"); // no phone number is copied into messages
    await expect(prepareCampaign(w.manager, c.id)).rejects.toThrow("already been prepared");
  });

  it("does not message someone again within a week, even in another campaign", async () => {
    const w = await makeWorld("itest-camp-cap");
    await customer(w, { visits: 2, daysAgo: 40 });
    const first = await createCampaign(w.owner, input({ name: "One" }));
    expect((await prepareCampaign(w.owner, first.id)).prepared).toBe(1);
    const second = await createCampaign(w.owner, input({ name: "Two" }));
    expect(await prepareCampaign(w.owner, second.id)).toMatchObject({ prepared: 0, tooSoon: 1 });
  });

  it("keeps businesses apart", async () => {
    const mine = await createCampaign(a.owner, input({ name: "Mine" }));
    await expect(prepareCampaign(b.owner, mine.id)).rejects.toThrow("Campaign not found");
    await expect(getCampaign(b.owner, mine.id)).rejects.toThrow("Campaign not found");
    await expect(exportQueued(b.owner, mine.id)).rejects.toThrow("Campaign not found");
    expect((await listCampaigns(b.owner)).some((c) => c.id === mine.id)).toBe(false);
  });
});

describe("sending, consent and opting out", () => {
  let w: World;
  let campaignId: string;
  const ids: { sita: string; ram: string } = { sita: "", ram: "" };

  beforeAll(async () => {
    w = await makeWorld("itest-camp-send");
    ids.sita = (await customer(w, { name: "Sita", visits: 2, daysAgo: 40 })).id;
    ids.ram = (await customer(w, { name: "Ram", visits: 2, daysAgo: 50 })).id;
    campaignId = (await createCampaign(w.owner, input())).id;
    await prepareCampaign(w.owner, campaignId);
  });

  const msgOf = (customerId: string) => db.campaignMessage.findFirstOrThrow({ where: { campaignId, customerId } });

  it("marks a message sent and starts the offer window at that moment", async () => {
    const m = await msgOf(ids.sita);
    await markSent(w.manager, m.id);
    const after = await msgOf(ids.sita);
    expect(after.status).toBe("SENT");
    expect(after.sentById).toBe(w.manager.userId);
    expect(after.expiresAt!.getTime() - after.sentAt!.getTime()).toBe(14 * DAY);
    await expect(markSent(w.manager, m.id)).rejects.toThrow("already marked");
    await expect(markSent(b.owner, m.id)).rejects.toThrow("Message not found");
    await expect(markSent(w.cashier, m.id)).rejects.toThrow("permission");
  });

  it("stops everything the moment a customer withdraws consent", async () => {
    const m = await msgOf(ids.ram);
    await recordOptOut(w.manager, m.id);
    expect(await db.customer.findUniqueOrThrow({ where: { id: ids.ram } })).toMatchObject({ marketingConsent: false, consentVerified: false });
    await expect(markSent(w.manager, m.id)).rejects.toThrow("no longer agrees");
    expect((await exportQueued(w.manager, campaignId)).rows).toHaveLength(0);
    const view = await getCampaign(w.manager, campaignId);
    expect(view.messages.find((x) => x.customerId === ids.ram)!.mayMessage).toBe(false);
    expect(view.messages.find((x) => x.customerId === ids.sita)!.mayMessage).toBe(true);
    await expect(recordOptOut(b.owner, m.id)).rejects.toThrow("Message not found");
  });

  it("exports only people who can be messaged and have not been sent to", async () => {
    const w2 = await makeWorld("itest-camp-export");
    const c1 = await customer(w2, { name: "Gita", visits: 2, daysAgo: 40 });
    const c2 = await customer(w2, { name: "Hari", visits: 2, daysAgo: 41 });
    const c = await createCampaign(w2.owner, input());
    await prepareCampaign(w2.owner, c.id);
    const first = await db.campaignMessage.findFirstOrThrow({ where: { campaignId: c.id, customerId: c1.id } });
    await markSent(w2.owner, first.id);
    const out = await exportQueued(w2.owner, c.id);
    expect(out.rows).toEqual([{ name: "Hari", phone: c2.phone, text: expect.stringContaining("Hari") }]);
  });
});

describe("what a campaign earns", () => {
  it("gives the bonus once when a messaged customer pays, and measures it", async () => {
    const w = await makeWorld("itest-camp-bonus");
    const cust = await customer(w, { name: "Sita", visits: 2, daysAgo: 40 });
    const camp = await createCampaign(w.owner, input());
    await prepareCampaign(w.owner, camp.id);
    const msg = await db.campaignMessage.findFirstOrThrow({ where: { campaignId: camp.id } });

    // Prepared but not sent: no bonus yet.
    const early = await payFor(w, cust.local);
    expect((await db.loyaltyEntry.findMany({ where: { customerId: cust.id, note: { startsWith: "Campaign" } } })).length).toBe(0);
    expect(early.pointsEarned).toBeGreaterThan(0);

    await markSent(w.owner, msg.id);
    const before = (await db.customer.findUniqueOrThrow({ where: { id: cust.id } })).pointsBalance;
    const inv = await payFor(w, cust.local);
    const after = await db.customer.findUniqueOrThrow({ where: { id: cust.id } });
    expect(after.pointsBalance).toBe(before + inv.pointsEarned + 50);
    const entry = await db.loyaltyEntry.findFirstOrThrow({ where: { customerId: cust.id, note: "Campaign: Win back" } });
    expect(entry).toMatchObject({ kind: "EARN", points: 50, invoiceId: inv.id });
    expect(await db.campaignMessage.findUniqueOrThrow({ where: { id: msg.id } })).toMatchObject({ redeemedInvoiceId: inv.id });

    // Only once.
    await payFor(w, cust.local);
    expect(await db.loyaltyEntry.count({ where: { customerId: cust.id, note: "Campaign: Win back" } })).toBe(1);

    const stats = (await getCampaign(w.owner, camp.id)).stats;
    expect(stats).toMatchObject({ prepared: 1, sent: 1, redeemed: 1, returned: 1, pointsGiven: 50, revenue: inv.grandTotal });
    // the cached balance still equals the ledger (this customer was created with 0 and only ever earned via entries)
    const sum = await db.loyaltyEntry.aggregate({ where: { customerId: cust.id }, _sum: { points: true } });
    expect((await db.customer.findUniqueOrThrow({ where: { id: cust.id } })).pointsBalance).toBe(sum._sum.points);
  });

  it("gives nothing for an expired offer, or a customer with no offer", async () => {
    const w = await makeWorld("itest-camp-expired");
    const cust = await customer(w, { visits: 2, daysAgo: 40 });
    const camp = await createCampaign(w.owner, input());
    await prepareCampaign(w.owner, camp.id);
    const msg = await db.campaignMessage.findFirstOrThrow({ where: { campaignId: camp.id } });
    await markSent(w.owner, msg.id);
    await db.campaignMessage.update({ where: { id: msg.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await payFor(w, cust.local);
    expect(await db.loyaltyEntry.count({ where: { customerId: cust.id, note: { startsWith: "Campaign" } } })).toBe(0);
    expect((await getCampaign(w.owner, camp.id)).stats.redeemed).toBe(0);

    const stranger = await customer(w, { visits: 1, daysAgo: 2 });
    await payFor(w, stranger.local); // never messaged
    expect(await db.loyaltyEntry.count({ where: { customerId: stranger.id, note: { startsWith: "Campaign" } } })).toBe(0);
  });

  it("claims one offer per bill, newest first, and never another business's offer", async () => {
    const w = await makeWorld("itest-camp-two");
    const other = await makeWorld("itest-camp-two-other");
    const cust = await customer(w, { visits: 2, daysAgo: 40 });
    const older = await db.campaign.create({ data: { businessId: w.owner.businessId, name: "Older", segment: "AT_RISK", template: "x".repeat(10), offerPoints: 30, offerDays: 14, preparedAt: new Date() } });
    const newer = await db.campaign.create({ data: { businessId: w.owner.businessId, name: "Newer", segment: "AT_RISK", template: "x".repeat(10), offerPoints: 70, offerDays: 14, preparedAt: new Date() } });
    const mk = (campaignId: string, points: number, sentDaysAgo: number) =>
      db.campaignMessage.create({
        data: { businessId: w.owner.businessId, campaignId, customerId: cust.id, text: "t", status: "SENT", offerPoints: points, sentAt: ago(sentDaysAgo), expiresAt: new Date(Date.now() + 5 * DAY) },
      });
    await mk(older.id, 30, 5);
    await mk(newer.id, 70, 1);
    // an offer in another business for a customer with the same phone must never apply here
    const theirs = await customer(other, { visits: 2, daysAgo: 40 });
    await db.campaignMessage.create({
      data: {
        businessId: other.owner.businessId,
        campaignId: (await db.campaign.create({ data: { businessId: other.owner.businessId, name: "Theirs", segment: "AT_RISK", template: "x".repeat(10), offerPoints: 999, offerDays: 14, preparedAt: new Date() } })).id,
        customerId: theirs.id, text: "t", status: "SENT", offerPoints: 999, sentAt: ago(1), expiresAt: new Date(Date.now() + 5 * DAY),
      },
    });

    await payFor(w, cust.local);
    const notes = await db.loyaltyEntry.findMany({ where: { customerId: cust.id, note: { startsWith: "Campaign" } } });
    expect(notes.map((x) => [x.note, x.points])).toEqual([["Campaign: Newer", 70]]);
    await payFor(w, cust.local); // the older one is still waiting for the next bill
    expect((await db.loyaltyEntry.findMany({ where: { customerId: cust.id, note: "Campaign: Older" } })).map((x) => x.points)).toEqual([30]);
    expect(await db.loyaltyEntry.count({ where: { customerId: theirs.id } })).toBe(0);
  });

  it("is removed with the customer when they ask to be erased", async () => {
    const w = await makeWorld("itest-camp-erase");
    const cust = await customer(w, { visits: 2, daysAgo: 40 });
    const camp = await createCampaign(w.owner, input());
    await prepareCampaign(w.owner, camp.id);
    expect(await db.campaignMessage.count({ where: { customerId: cust.id } })).toBe(1);
    await deleteCustomer(w.owner, cust.id);
    expect(await db.campaignMessage.count({ where: { customerId: cust.id } })).toBe(0);
    expect((await getCampaign(w.owner, camp.id)).stats.prepared).toBe(0);
  });
});
