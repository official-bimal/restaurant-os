import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { setLoyaltySettings } from "@/features/loyalty/server/customers";
import type { FetchLike } from "../client";
import { disconnect, getLinkStatus, loadTarget, saveLink, setSending } from "./link";
import { enqueueIfLinked, flushAll, flushBusiness, lookupBalance, retryFailed } from "./outbox";

const stamp = Date.now();
const businessIds: string[] = [];
const KEY = "cos_live_" + "k".repeat(43);
let n = 0;

interface World {
  owner: TenantContext;
  manager: TenantContext;
  businessId: string;
  branchId: string;
  customerId: string;
  phone: string;
}

async function makeWorld(name: string): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, manager] = await Promise.all([mk("owner"), mk("mgr")]);
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  await db.membership.create({ data: { userId: manager.id, businessId: biz.id, role: "MANAGER", allBranches: true } });
  const phone = `+97798${String(50_000_000 + ++n + (stamp % 1000) * 10)}`;
  const customer = await db.customer.create({ data: { businessId: biz.id, phone, name: "Sita" } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return { owner: { ...base, userId: owner.id, role: "OWNER" }, manager: { ...base, userId: manager.id, role: "MANAGER" }, businessId: biz.id, branchId: branch.id, customerId: customer.id, phone };
}

let seq = 0;
/** A paid bill for the world's customer, as checkout would have left it. */
async function paidBill(w: World, over: { grandTotal?: number; deliveryFee?: number; link?: boolean; customerId?: string | null } = {}) {
  seq += 1;
  const customerId = over.customerId === undefined ? w.customerId : over.customerId;
  const order = await db.order.create({
    data: { businessId: w.businessId, branchId: w.branchId, number: seq, type: "TAKEAWAY", status: "PAID", customerId, createdById: w.owner.userId, idempotencyKey: `cos-${stamp}-${w.businessId}-${seq}` },
  });
  const grandTotal = over.grandTotal ?? 85_000;
  const invoice = await db.invoice.create({
    data: {
      businessId: w.businessId,
      branchId: w.branchId,
      orderId: order.id,
      number: seq,
      subtotal: grandTotal,
      discount: 0,
      serviceCharge: 0,
      vat: 0,
      roundOff: 0,
      grandTotal,
      loyaltyDiscount: 0,
      deliveryFee: over.deliveryFee ?? 0,
      customerId,
      pointsEarned: 0,
      pointsRedeemed: 0,
    },
  });
  const queued = await db.$transaction((tx) => enqueueIfLinked(tx, { businessId: w.businessId, invoiceId: invoice.id, customerId }));
  return { invoice, queued };
}

/** A pretend Customer OS that records what it was asked and answers from a script. */
function fakeCos(script: (call: { method: string; path: string; body: unknown; auth: string | null }) => { status: number; body: unknown }) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call = {
      method: String(init.method),
      path: new URL(url).pathname.replace("/api/integrations/v1", ""),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init.headers as HeadersInit).get("authorization"),
    };
    calls.push(call);
    const r = script(call);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}
const ok = (data: unknown) => ({ status: 200, body: { ok: true, data } });
const err = (status: number, message: string) => ({ status, body: { ok: false, error: { code: "X", message } } });
const purchaseOk = (pointsEarned = 8) => ok({ purchaseId: "p1", deduplicated: false, pointsEarned, balance: pointsEarned, programType: "POINTS", rewardsAvailable: 0 });

async function connect(w: World) {
  const cos = fakeCos(() => ok({ business: "Demo Cafe" }));
  await saveLink(w.owner, { baseUrl: "https://customers.example.com/", key: KEY }, { fetchImpl: cos.fetchImpl });
}

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-cos-a");
  b = await makeWorld("itest-cos-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.customerOsEvent.deleteMany({ where: { businessId: id } });
    await db.customerOsLink.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.customer.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("nothing happens until it is connected", () => {
  it("a paid bill is not queued, and the page helpers say 'off'", async () => {
    const { queued } = await paidBill(a);
    expect(queued).toBe(false);
    expect(await db.customerOsEvent.count({ where: { businessId: a.businessId } })).toBe(0);
    expect(await lookupBalance(a.owner, a.customerId)).toEqual({ state: "off" });
    expect(await loadTarget(a.businessId)).toBeNull();
  });
});

describe("connecting", () => {
  it("only the owner can connect, and a bad address or a key of the wrong shape is refused before any call", async () => {
    const cos = fakeCos(() => ok({ business: "x" }));
    await expect(saveLink(a.manager, { baseUrl: "https://c.example.com", key: KEY }, { fetchImpl: cos.fetchImpl })).rejects.toThrow(/owner/);
    await expect(saveLink(a.owner, { baseUrl: "ftp://c.example.com", key: KEY }, { fetchImpl: cos.fetchImpl })).rejects.toThrow(/address/);
    await expect(saveLink(a.owner, { baseUrl: "https://u:p@c.example.com", key: KEY }, { fetchImpl: cos.fetchImpl })).rejects.toThrow(/address/);
    await expect(saveLink(a.owner, { baseUrl: "https://c.example.com", key: "nope" }, { fetchImpl: cos.fetchImpl })).rejects.toThrow(/key/);
    expect(cos.calls).toHaveLength(0);
  });

  it("a key Customer OS refuses saves nothing", async () => {
    const cos = fakeCos(() => err(401, "The key is missing, wrong or revoked."));
    await expect(saveLink(a.owner, { baseUrl: "https://c.example.com", key: KEY }, { fetchImpl: cos.fetchImpl })).rejects.toThrow(/did not accept/);
    expect(await db.customerOsLink.count({ where: { businessId: a.businessId } })).toBe(0);
  });

  it("saves the key encrypted, turns this app's own points off, and checks the key with a ping", async () => {
    const cos = fakeCos(() => ok({ business: "Demo Cafe" }));
    const r = await saveLink(a.owner, { baseUrl: "https://customers.example.com/", key: KEY }, { fetchImpl: cos.fetchImpl });
    expect(r.business).toBe("Demo Cafe");
    expect(cos.calls[0]).toMatchObject({ method: "GET", path: "/ping", auth: `Bearer ${KEY}` });
    const row = await db.customerOsLink.findUniqueOrThrow({ where: { businessId: a.businessId } });
    expect(row.keyEnc).not.toContain(KEY);
    expect(row.baseUrl).toBe("https://customers.example.com");
    expect(row.keyPrefix).toBe(KEY.slice(0, 14));
    expect((await loadTarget(a.businessId))?.target.key).toBe(KEY);
    expect((await db.business.findUniqueOrThrow({ where: { id: a.businessId } })).loyaltyEnabled).toBe(false);
    const status = await getLinkStatus(a.owner);
    expect(status).toMatchObject({ connected: true, enabled: true, keyUnreadable: false });
    expect(JSON.stringify(status)).not.toContain(KEY);
  });

  it("while connected, this app's own points cannot be switched back on", async () => {
    await expect(setLoyaltySettings(a.owner, { enabled: true, pointsPer100: 10, redeemPoints: 100, redeemValue: 5000 })).rejects.toThrow(/Customer OS/);
    await setLoyaltySettings(a.owner, { enabled: false, pointsPer100: 10, redeemPoints: 100, redeemValue: 5000 });
  });
});

describe("sending paid bills", () => {
  it("queues a bill with a customer and sends it as a purchase: food amount, sale time, phone", async () => {
    const { invoice, queued } = await paidBill(a, { grandTotal: 100_000, deliveryFee: 15_000 });
    expect(queued).toBe(true);
    const cos = fakeCos(() => purchaseOk(8));
    const rep = await flushBusiness(a.businessId, { fetchImpl: cos.fetchImpl });
    expect(rep).toEqual({ sent: 1, waiting: 0, failed: 0 });
    expect(cos.calls).toHaveLength(1);
    expect(cos.calls[0]).toMatchObject({
      method: "POST",
      path: "/purchases",
      auth: `Bearer ${KEY}`,
      body: { externalId: invoice.id, phone: a.phone, name: "Sita", amountMinor: 85_000, occurredAt: invoice.createdAt.toISOString() },
    });
    const ev = await db.customerOsEvent.findUniqueOrThrow({ where: { businessId_kind_refId: { businessId: a.businessId, kind: "PURCHASE", refId: invoice.id } } });
    expect(ev).toMatchObject({ status: "SENT", pointsEarned: 8, attempts: 1, lastError: null });
  });

  it("a bill already sent is never sent again, however often it runs", async () => {
    const cos = fakeCos(() => purchaseOk());
    expect(await flushBusiness(a.businessId, { fetchImpl: cos.fetchImpl })).toEqual({ sent: 0, waiting: 0, failed: 0 });
    expect(cos.calls).toHaveLength(0);
  });

  it("a bill with no customer is not queued", async () => {
    const { queued } = await paidBill(a, { customerId: null });
    expect(queued).toBe(false);
  });

  it("a Customer OS outage keeps the bill waiting with growing gaps, then it goes through", async () => {
    const { invoice } = await paidBill(a);
    const down = fakeCos(() => err(503, "Maintenance"));
    const t0 = new Date();
    expect(await flushBusiness(a.businessId, { fetchImpl: down.fetchImpl, now: t0 })).toEqual({ sent: 0, waiting: 1, failed: 0 });
    let ev = await db.customerOsEvent.findUniqueOrThrow({ where: { businessId_kind_refId: { businessId: a.businessId, kind: "PURCHASE", refId: invoice.id } } });
    expect(ev).toMatchObject({ status: "PENDING", attempts: 1, lastError: "Maintenance" });
    expect(ev.nextAttemptAt.getTime()).toBeGreaterThan(t0.getTime());

    // Not due yet: nothing is sent.
    const early = fakeCos(() => purchaseOk());
    expect((await flushBusiness(a.businessId, { fetchImpl: early.fetchImpl, now: t0 })).sent).toBe(0);
    expect(early.calls).toHaveLength(0);

    // Later it is due, and Customer OS is back.
    const back = fakeCos(() => purchaseOk(5));
    const later = new Date(t0.getTime() + 61 * 60_000);
    expect(await flushBusiness(a.businessId, { fetchImpl: back.fetchImpl, now: later })).toEqual({ sent: 1, waiting: 0, failed: 0 });
    ev = await db.customerOsEvent.findUniqueOrThrow({ where: { id: ev.id } });
    expect(ev).toMatchObject({ status: "SENT", pointsEarned: 5, attempts: 2 });
  });

  it("no internet counts as an outage too, and is retried", async () => {
    await paidBill(a);
    const offline: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await flushBusiness(a.businessId, { fetchImpl: offline, now: new Date(Date.now() + 3 * 3_600_000) })).toMatchObject({ waiting: 1, failed: 0 });
    const link = await db.customerOsLink.findUniqueOrThrow({ where: { businessId: a.businessId } });
    expect(link.lastError).toMatch(/Could not reach/);
    // Clean up for the next tests: make the waiting bill go through.
    const ok1 = fakeCos(() => purchaseOk());
    await flushBusiness(a.businessId, { fetchImpl: ok1.fetchImpl, now: new Date(Date.now() + 10 * 3_600_000) });
  });

  it("a rejected key stops the round and keeps every bill waiting; a new key sends them", async () => {
    await paidBill(a);
    await paidBill(a);
    const refused = fakeCos(() => err(401, "revoked"));
    const rep = await flushBusiness(a.businessId, { fetchImpl: refused.fetchImpl, now: new Date(Date.now() + 20 * 3_600_000) });
    expect(rep.sent).toBe(0);
    expect(refused.calls).toHaveLength(1); // it stopped after the first refusal
    expect((await db.customerOsLink.findUniqueOrThrow({ where: { businessId: a.businessId } })).lastError).toMatch(/did not accept the key/);
    expect(await db.customerOsEvent.count({ where: { businessId: a.businessId, status: "PENDING" } })).toBe(2);
    const good = fakeCos(() => purchaseOk());
    const rep2 = await flushBusiness(a.businessId, { fetchImpl: good.fetchImpl, now: new Date(Date.now() + 40 * 3_600_000) });
    expect(rep2.sent).toBe(2);
  });

  it("a request Customer OS will never accept fails for good, and 'try again' queues it once more", async () => {
    const { invoice } = await paidBill(a);
    const never = fakeCos(() => err(422, "That phone number is not a valid Nepal mobile number."));
    expect(await flushBusiness(a.businessId, { fetchImpl: never.fetchImpl })).toEqual({ sent: 0, waiting: 0, failed: 1 });
    const ev = await db.customerOsEvent.findUniqueOrThrow({ where: { businessId_kind_refId: { businessId: a.businessId, kind: "PURCHASE", refId: invoice.id } } });
    expect(ev.status).toBe("FAILED");
    expect(ev.lastError).toMatch(/phone/);
    await expect(retryFailed(a.manager)).rejects.toThrow(/owner/);
    expect(await retryFailed(a.owner)).toBe(1);
    const good = fakeCos(() => purchaseOk());
    expect((await flushBusiness(a.businessId, { fetchImpl: good.fetchImpl })).sent).toBe(1);
  });

  it("a bill with nothing but a delivery fee is closed without a call", async () => {
    const { invoice } = await paidBill(a, { grandTotal: 15_000, deliveryFee: 15_000 });
    const cos = fakeCos(() => purchaseOk());
    await flushBusiness(a.businessId, { fetchImpl: cos.fetchImpl });
    expect(cos.calls).toHaveLength(0);
    const ev = await db.customerOsEvent.findUniqueOrThrow({ where: { businessId_kind_refId: { businessId: a.businessId, kind: "PURCHASE", refId: invoice.id } } });
    expect(ev).toMatchObject({ status: "SENT", pointsEarned: 0 });
  });

  it("two runs at the same moment send each bill once", async () => {
    await paidBill(a);
    const cos = fakeCos(() => purchaseOk());
    await Promise.all([flushBusiness(a.businessId, { fetchImpl: cos.fetchImpl }), flushBusiness(a.businessId, { fetchImpl: cos.fetchImpl })]);
    expect(cos.calls.filter((c) => c.path === "/purchases")).toHaveLength(1);
  });

  it("paused: bills are still queued but nothing is sent until it is resumed", async () => {
    await setSending(a.owner, false);
    const { queued } = await paidBill(a);
    expect(queued).toBe(true);
    const cos = fakeCos(() => purchaseOk());
    expect(await flushBusiness(a.businessId, { fetchImpl: cos.fetchImpl })).toEqual({ sent: 0, waiting: 0, failed: 0 });
    expect(await flushAll({ fetchImpl: cos.fetchImpl })).not.toHaveProperty(a.businessId);
    expect(cos.calls).toHaveLength(0);
    await setSending(a.owner, true);
    expect((await flushBusiness(a.businessId, { fetchImpl: cos.fetchImpl })).sent).toBe(1);
  });

  it("one business's run never touches another business's bills or key", async () => {
    await connect(b);
    const { invoice } = await paidBill(b);
    const cos = fakeCos(() => purchaseOk());
    await flushBusiness(a.businessId, { fetchImpl: cos.fetchImpl });
    expect(cos.calls).toHaveLength(0);
    const ev = await db.customerOsEvent.findUniqueOrThrow({ where: { businessId_kind_refId: { businessId: b.businessId, kind: "PURCHASE", refId: invoice.id } } });
    expect(ev.status).toBe("PENDING");
    await flushBusiness(b.businessId, { fetchImpl: cos.fetchImpl });
    expect(cos.calls).toHaveLength(1);
    expect(cos.calls[0]!.body).toMatchObject({ externalId: invoice.id, phone: b.phone });
  });
});

describe("reading the balance back", () => {
  it("shows Customer OS's balance, or 'unavailable' when it cannot be reached; it never throws", async () => {
    const good = fakeCos(() => ok({ found: true, name: "Sita", program: { name: "Rewards", type: "POINTS" }, balance: 42, rewardCost: 500, rewardName: "Rs 500 off", rewardsAvailable: 0, totalSpendMinor: 1, purchaseCount: 1 }));
    const v = await lookupBalance(a.owner, a.customerId, { fetchImpl: good.fetchImpl });
    expect(v).toMatchObject({ state: "ok", balance: { found: true, balance: 42 } });
    expect(good.calls[0]).toMatchObject({ path: "/customers/lookup", body: { phone: a.phone } });

    const down = fakeCos(() => err(503, "x"));
    expect(await lookupBalance(a.owner, a.customerId, { fetchImpl: down.fetchImpl })).toEqual({ state: "unavailable" });
    const thrown: FetchLike = async () => {
      throw new Error("boom");
    };
    expect(await lookupBalance(a.owner, a.customerId, { fetchImpl: thrown })).toEqual({ state: "unavailable" });
  });

  it("another business's customer id is not looked up", async () => {
    const cos = fakeCos(() => ok({ found: false }));
    expect(await lookupBalance(a.owner, b.customerId, { fetchImpl: cos.fetchImpl })).toEqual({ state: "unavailable" });
    expect(cos.calls).toHaveLength(0);
  });
});

describe("disconnecting", () => {
  it("removes the key, keeps the bills, and a new bill is no longer queued", async () => {
    await disconnect(a.owner);
    expect(await db.customerOsLink.count({ where: { businessId: a.businessId } })).toBe(0);
    expect(await db.customerOsEvent.count({ where: { businessId: a.businessId } })).toBeGreaterThan(0);
    const { queued } = await paidBill(a);
    expect(queued).toBe(false);
    expect(await getLinkStatus(a.owner)).toMatchObject({ connected: false, keyPrefix: null });
  });
});
