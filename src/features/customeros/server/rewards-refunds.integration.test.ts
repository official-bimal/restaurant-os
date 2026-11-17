import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { checkout as checkoutRaw, previewBill } from "@/features/orders/server/service";
import { refundInvoice as refundRaw } from "@/features/orders/server/void";
import { saveLink } from "./link";
import { drainBackgroundSends, enqueueIfLinked, enqueueRelease, flushBusiness, refundShare } from "./outbox";

/** The real functions start a background send after saving; wait for it so each test sees a settled queue. */
const refundInvoice = async (...args: Parameters<typeof refundRaw>) => {
  try {
    return await refundRaw(...args);
  } finally {
    await drainBackgroundSends();
  }
};
const checkout = async (...args: Parameters<typeof checkoutRaw>) => {
  try {
    return await checkoutRaw(...args);
  } finally {
    await drainBackgroundSends();
  }
};

const stamp = Date.now();
const businessIds: string[] = [];
const KEY = "cos_live_" + "r".repeat(43);
let n = 0;

// ---------- a pretend Customer OS, as a real HTTP server, so the real fetch code runs ----------

interface Call {
  path: string;
  body: Record<string, unknown>;
}
const calls: Call[] = [];
let handler: (c: Call) => { status: number; body: unknown } = () => ({ status: 404, body: { ok: false, error: { message: "unscripted" } } });
let server: Server;
let baseUrl = "";

const ok = (data: unknown) => ({ status: 200, body: { ok: true, data } });
const err = (status: number, message: string) => ({ status, body: { ok: false, error: { code: "X", message } } });

const REWARD = { customerRewardId: "rw-1", name: "Rs 500 off", type: "DISCOUNT", valueMinor: 50_000, requiredBalance: 500, redeemable: true };
const lookup = (rewards: unknown[] = [REWARD]) => ok({ found: true, name: "Sita", program: { name: "R", type: "POINTS" }, balance: 500, rewardCost: 500, rewardName: "Rs 500 off", rewardsAvailable: rewards.length, rewards, totalSpendMinor: 1, purchaseCount: 1 });
const redeemed = () => ok({ redemptionId: "red-1", rewardName: "Rs 500 off", type: "DISCOUNT", valueMinor: 50_000, consumed: 500, balance: 0, deduplicated: false });

/** The usual healthy Customer OS. */
const healthy = (c: Call) => {
  if (c.path === "/ping") return ok({ business: "Demo" });
  if (c.path === "/customers/lookup") return lookup();
  if (c.path === "/rewards/redeem") return redeemed();
  if (c.path === "/rewards/release") return ok({ released: true, deduplicated: false, balance: 500 });
  if (c.path === "/purchases") return ok({ purchaseId: "p1", deduplicated: false, pointsEarned: 8, balance: 8, programType: "POINTS", rewardsAvailable: 0 });
  if (c.path === "/refunds") return ok({ counted: 1, pointsReversed: 4, pointsShortfall: 0, balance: 4, deduplicated: false, fullyRefunded: false });
  return err(404, "unscripted");
};
const of = (path: string) => calls.filter((c) => c.path === path);

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const c: Call = { path: (req.url ?? "").replace("/api/integrations/v1", ""), body: raw ? JSON.parse(raw) : {} };
      calls.push(c);
      const r = handler(c);
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  calls.length = 0;
  handler = healthy;
});

// ---------- a business with a customer and a way to make bills ----------

interface World {
  owner: TenantContext;
  businessId: string;
  branchId: string;
  customerId: string;
  phone: string;
  itemId: string;
}

async function makeWorld(name: string): Promise<World> {
  const owner = await db.user.create({ data: { email: `${name}-owner-${stamp}@it.test`, name: `${name} owner`, passwordHash: "x" } });
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const item = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Thali", price: 100_000 } }); // Rs 1,000
  const phone = `+97798${String(60_000_000 + ++n + (stamp % 1000) * 10)}`;
  const customer = await db.customer.create({ data: { businessId: biz.id, phone, name: "Sita" } });
  return { owner: { businessId: biz.id, branchId: branch.id, branchIds: [branch.id], userId: owner.id, role: "OWNER" }, businessId: biz.id, branchId: branch.id, customerId: customer.id, phone, itemId: item.id };
}

let seq = 0;
async function openOrder(w: World, o: { confirmed?: boolean; quantity?: number } = {}) {
  seq += 1;
  const order = await db.order.create({
    data: { businessId: w.businessId, branchId: w.branchId, number: seq, type: "TAKEAWAY", status: "OPEN", customerId: w.customerId, customerConfirmed: o.confirmed ?? true, createdById: w.owner.userId, idempotencyKey: `cosr-${stamp}-${w.businessId}-${seq}` },
  });
  await db.orderItem.create({ data: { businessId: w.businessId, orderId: order.id, menuItemId: w.itemId, name: "Thali", unitPrice: 100_000, quantity: o.quantity ?? 1, status: "SERVED" } });
  return order;
}

/** An already paid bill with its payment, queued the way checkout queues it. */
async function paidBill(w: World, grandTotal = 100_000, deliveryFee = 0) {
  seq += 1;
  const order = await db.order.create({ data: { businessId: w.businessId, branchId: w.branchId, number: seq, type: "TAKEAWAY", status: "PAID", customerId: w.customerId, createdById: w.owner.userId, idempotencyKey: `cosp-${stamp}-${w.businessId}-${seq}` } });
  const invoice = await db.invoice.create({
    data: { businessId: w.businessId, branchId: w.branchId, orderId: order.id, number: 9000 + seq, subtotal: grandTotal, discount: 0, serviceCharge: 0, vat: 0, roundOff: 0, grandTotal, loyaltyDiscount: 0, deliveryFee, customerId: w.customerId, pointsEarned: 0, pointsRedeemed: 0 },
  });
  await db.payment.create({ data: { businessId: w.businessId, invoiceId: invoice.id, method: "CASH", amount: grandTotal } });
  const queued = await db.$transaction((tx) => enqueueIfLinked(tx, { businessId: w.businessId, invoiceId: invoice.id, customerId: w.customerId }));
  return { invoice, queued };
}

let a: World;
beforeAll(async () => {
  a = await makeWorld("itest-cosr-a");
  handler = healthy;
  await saveLink(a.owner, { baseUrl, key: KEY });
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.customerOsEvent.deleteMany({ where: { businessId: id } });
    await db.customerOsLink.deleteMany({ where: { businessId: id } });
    await db.loyaltyEntry.deleteMany({ where: { businessId: id } });
    await db.stockMovement.deleteMany({ where: { businessId: id } });
    await db.refundPayment.deleteMany({ where: { businessId: id } });
    await db.creditNote.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.customer.deleteMany({ where: { businessId: id } });
    await db.menuItem.deleteMany({ where: { businessId: id } });
    await db.menuCategory.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

const events = (w: World, kind: string) => db.customerOsEvent.findMany({ where: { businessId: w.businessId, kind: kind as never }, orderBy: { createdAt: "asc" } });

describe("how a refund's share is counted", () => {
  const notes = (...p: [string, number, boolean][]) => p.map(([id, grandTotal, partial]) => ({ id, grandTotal, partial }));
  it("takes a proportional share of the food, and the finishing note takes exactly the rest", () => {
    // Bill Rs 1,150 of which Rs 150 delivery: food Rs 1,000.
    const ns = notes(["a", 23_000, true], ["b", 23_000, true], ["c", 69_000, false]);
    const shares = ["a", "b", "c"].map((id) => refundShare(115_000, 100_000, ns, id));
    expect(shares).toEqual([20_000, 20_000, 60_000]);
    expect(shares.reduce((x, y) => x! + y!, 0)).toBe(100_000);
  });
  it("never counts more than the food in total, even with awkward rounding", () => {
    const ns = notes(["a", 33_333, true], ["b", 33_333, true], ["c", 33_334, false]);
    const shares = ["a", "b", "c"].map((id) => refundShare(100_000, 100_000, ns, id)!);
    expect(shares.reduce((x, y) => x + y, 0)).toBe(100_000);
  });
  it("is null for a note that is not there, and 0 when there is no food", () => {
    expect(refundShare(100, 100, notes(["a", 100, false]), "zzz")).toBeNull();
    expect(refundShare(15_000, 0, notes(["a", 15_000, false]), "a")).toBe(0);
  });
});

describe("refunds", () => {
  it("a refund is queued with its bill's sale, sent after the sale, and leaves this app's own points alone", async () => {
    const { invoice } = await paidBill(a, 100_000, 15_000); // food Rs 850 of Rs 1,000
    await db.customer.update({ where: { businessId_id: { businessId: a.businessId, id: a.customerId } }, data: { pointsBalance: 77 } });
    const note = await refundInvoice(a.owner, invoice.id, "Wrong dish ordered", { amount: 50_000 }); // half
    expect(await events(a, "REFUND")).toHaveLength(1);

    // The refund started a background send, which the helper waited for: the sale and then the refund have gone.
    const order = calls.map((c) => c.path);
    expect(order.indexOf("/purchases")).toBeLessThan(order.indexOf("/refunds"));
    expect(of("/refunds")[0]!.body).toEqual({ saleExternalId: invoice.id, externalRefundId: note.id, amountMinor: 42_500 }); // half of the food
    expect(await db.customerOsEvent.count({ where: { businessId: a.businessId, invoiceId: invoice.id, status: "SENT" } })).toBe(2);
    expect((await db.customer.findUniqueOrThrow({ where: { businessId_id: { businessId: a.businessId, id: a.customerId } } })).pointsBalance).toBe(77);
    const ev = (await events(a, "REFUND"))[0]!;
    expect(ev).toMatchObject({ status: "SENT", pointsEarned: 4 });
  });

  it("the refund that finishes the bill takes exactly the rest of the food", async () => {
    const { invoice } = await paidBill(a, 100_000, 15_000);
    const first = await refundInvoice(a.owner, invoice.id, "Part refund given", { amount: 33_333 });
    const last = await refundInvoice(a.owner, invoice.id, "Rest refunded");
    await flushBusiness(a.businessId);
    const sent = of("/refunds").filter((c) => c.body.saleExternalId === invoice.id).map((c) => c.body);
    expect(sent.map((b) => b.externalRefundId)).toEqual([first.id, last.id]);
    const total = sent.reduce((s, b) => s + (b.amountMinor as number), 0);
    expect(total).toBe(85_000);
  });

  it("while the sale has not reached Customer OS, the refund waits without using up tries", async () => {
    const { invoice } = await paidBill(a);
    handler = (c) => (c.path === "/purchases" ? err(503, "Maintenance") : healthy(c));
    await refundInvoice(a.owner, invoice.id, "Wrong dish ordered", { amount: 10_000 });
    expect(of("/refunds")).toHaveLength(0);
    const refund = (await events(a, "REFUND")).at(-1)!;
    expect(refund).toMatchObject({ status: "PENDING", attempts: 0 });
    // Sale goes through later, then the refund does too.
    handler = healthy;
    const later = new Date(Date.now() + 3 * 3_600_000);
    await flushBusiness(a.businessId, { now: later });
    await flushBusiness(a.businessId, { now: new Date(later.getTime() + 2 * 60_000) });
    expect(of("/refunds")).toHaveLength(1);
  });

  it("a bill paid before Customer OS was connected has nothing there to take back", async () => {
    // A bill with no sale event, as if paid before connecting.
    seq += 1;
    const order = await db.order.create({ data: { businessId: a.businessId, branchId: a.branchId, number: seq, type: "TAKEAWAY", status: "PAID", customerId: a.customerId, createdById: a.owner.userId, idempotencyKey: `cosold-${stamp}-${seq}` } });
    const invoice = await db.invoice.create({ data: { businessId: a.businessId, branchId: a.branchId, orderId: order.id, number: 9000 + seq, subtotal: 50_000, discount: 0, serviceCharge: 0, vat: 0, roundOff: 0, grandTotal: 50_000, loyaltyDiscount: 0, deliveryFee: 0, customerId: a.customerId, pointsEarned: 0, pointsRedeemed: 0 } });
    await db.payment.create({ data: { businessId: a.businessId, invoiceId: invoice.id, method: "CASH", amount: 50_000 } });
    await refundInvoice(a.owner, invoice.id, "Old bill refund");
    expect(await db.customerOsEvent.count({ where: { businessId: a.businessId, kind: "REFUND", invoiceId: invoice.id } })).toBe(0);
  });

  it("a sale that Customer OS never accepted cannot have its points taken back: the refund fails with the reason", async () => {
    const { invoice } = await paidBill(a);
    handler = (c) => (c.path === "/purchases" ? err(422, "No") : healthy(c));
    await refundInvoice(a.owner, invoice.id, "Not accepted", { amount: 10_000 });
    const refund = (await events(a, "REFUND")).at(-1)!;
    expect(refund.status).toBe("FAILED");
    expect(refund.lastError).toMatch(/never recorded/);
    expect(of("/refunds")).toHaveLength(0);
  });

  it("a shortfall is reported on the page, not treated as an error", async () => {
    const { invoice } = await paidBill(a);
    handler = (c) => (c.path === "/refunds" ? ok({ counted: 100_000, pointsReversed: 0, pointsShortfall: 8, balance: 0, deduplicated: false, fullyRefunded: true }) : healthy(c));
    await refundInvoice(a.owner, invoice.id, "Shortfall case");
    const refund = (await events(a, "REFUND")).at(-1)!;
    expect(refund).toMatchObject({ status: "SENT", pointsEarned: 0 });
    expect(refund.lastError).toMatch(/8 points could not be taken back/);
  });
});

describe("using a Customer OS reward at checkout", () => {
  const pay = async (orderId: string, rewardId?: string, wrong = 0) => {
    const t = await previewBill(a.owner, orderId, { kind: "none" }, 0, rewardId ? { valueMinor: 50_000 } : null);
    return checkout(a.owner, orderId, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal + wrong }], rewardId });
  };

  it("uses the reward first, discounts the bill, and keeps the use with the paid bill", async () => {
    const order = await openOrder(a);
    const invoice = await pay(order.id, "rw-1");
    expect(invoice.loyaltyDiscount).toBe(50_000);
    expect(invoice.pointsRedeemed).toBe(500);
    expect(of("/rewards/redeem")).toHaveLength(1);
    expect(of("/rewards/redeem")[0]!.body).toMatchObject({ customerRewardId: "rw-1", phone: a.phone });
    expect(of("/rewards/release")).toHaveLength(0);
    const redeem = (await events(a, "REDEEM")).at(-1)!;
    expect(redeem).toMatchObject({ status: "SENT", invoiceId: order.id, pointsEarned: 500 });
    expect(redeem.refId).toBe(of("/rewards/redeem")[0]!.body.externalId);
    await flushBusiness(a.businessId); // the sale itself goes after
    expect(of("/purchases").at(-1)!.body.amountMinor).toBe(invoice.grandTotal);
  });

  it("a bill that cannot be paid gives the reward's points back, and nothing is left half done", async () => {
    const order = await openOrder(a);
    await expect(pay(order.id, "rw-1", 100)).rejects.toThrow(/add up/);
    expect(of("/rewards/redeem")).toHaveLength(1);
    expect(of("/rewards/release")).toHaveLength(1);
    expect(of("/rewards/release")[0]!.body.externalId).toBe(of("/rewards/redeem")[0]!.body.externalId);
    expect(await db.invoice.count({ where: { orderId: order.id } })).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("OPEN");
    expect(await db.customerOsEvent.count({ where: { businessId: a.businessId, kind: "REDEEM", invoiceId: order.id } })).toBe(0);
  });

  it("retrying that bill uses the reward again with a NEW id, so the earlier release cannot hand out a free discount", async () => {
    const order = await openOrder(a);
    await expect(pay(order.id, "rw-1", 100)).rejects.toThrow();
    await pay(order.id, "rw-1");
    const ids = of("/rewards/redeem").map((c) => c.body.externalId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(of("/rewards/release")).toHaveLength(1);
    expect(of("/rewards/release")[0]!.body.externalId).toBe(ids[0]);
  });

  it("a reward bigger than the bill is refused and given back", async () => {
    const order = await openOrder(a);
    handler = (c) => (c.path === "/customers/lookup" ? lookup([{ ...REWARD, valueMinor: 500_000 }]) : c.path === "/rewards/redeem" ? ok({ ...(redeemed().body.data as object), valueMinor: 500_000 }) : healthy(c));
    await expect(checkout(a.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 100_000 }], rewardId: "rw-1" })).rejects.toThrow(/larger than the bill/);
    expect(of("/rewards/release")).toHaveLength(1);
  });

  it("Customer OS down: nothing is paid, the cashier is told, and a release is queued in case it did use the reward", async () => {
    const order = await openOrder(a);
    handler = (c) => (c.path === "/rewards/redeem" ? err(503, "down") : healthy(c));
    await expect(pay(order.id, "rw-1")).rejects.toThrow(/could not be reached/);
    expect(await db.invoice.count({ where: { orderId: order.id } })).toBe(0);
    const release = (await events(a, "RELEASE")).at(-1)!;
    expect(release).toMatchObject({ status: "PENDING", invoiceId: order.id });
    expect(release.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 5 * 60_000); // gives a retry time to finish first
  });

  it("a refused reward (already used, wrong customer) stops the bill with Customer OS's reason", async () => {
    const order = await openOrder(a);
    handler = (c) => (c.path === "/rewards/redeem" ? err(409, "Reward has already been redeemed.") : healthy(c));
    await expect(pay(order.id, "rw-1")).rejects.toThrow(/already been redeemed/);
    expect(await db.invoice.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("the customer must be confirmed in person, and be on the order", async () => {
    const unconfirmed = await openOrder(a, { confirmed: false });
    await expect(checkout(a.owner, unconfirmed.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 1 }], rewardId: "rw-1" })).rejects.toThrow(/Confirm in person/);
    expect(of("/rewards/redeem")).toHaveLength(0);
  });

  it("a reward that is no longer on the customer's list is refused before anything is used", async () => {
    const order = await openOrder(a);
    handler = (c) => (c.path === "/customers/lookup" ? lookup([]) : healthy(c));
    await expect(pay(order.id, "rw-1")).rejects.toThrow(/no longer available/);
    expect(of("/rewards/redeem")).toHaveLength(0);
  });

  it("a bill without a reward does not call the reward endpoints at all", async () => {
    const order = await openOrder(a);
    const invoice = await pay(order.id);
    expect(invoice.pointsRedeemed).toBe(0);
    expect(of("/rewards/redeem")).toHaveLength(0);
    expect(of("/customers/lookup")).toHaveLength(0);
  });
});

describe("giving a reward back later", () => {
  it("a queued release is sent, and a 404 ('nothing was used') counts as done", async () => {
    const order = await openOrder(a);
    await enqueueRelease(a.businessId, order.id, `${order.id}:aaaa1111`, 0);
    handler = (c) => (c.path === "/rewards/release" ? err(404, "No reward was used on that sale.") : healthy(c));
    await flushBusiness(a.businessId, { now: new Date(Date.now() + 1000) });
    const ev = (await events(a, "RELEASE")).find((e) => e.refId === `${order.id}:aaaa1111`)!;
    expect(ev).toMatchObject({ status: "SENT", lastError: "Nothing to give back." });
  });

  it("a release for a reward that ended up on a PAID bill is skipped: the reward stays used", async () => {
    const order = await openOrder(a);
    const invoice = await (async () => {
      const t = await previewBill(a.owner, order.id, { kind: "none" }, 0, { valueMinor: 50_000 });
      return checkout(a.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }], rewardId: "rw-1" });
    })();
    expect(invoice.pointsRedeemed).toBe(500);
    const usedId = of("/rewards/redeem").at(-1)!.body.externalId as string;
    calls.length = 0;
    await enqueueRelease(a.businessId, order.id, usedId, 0);
    await flushBusiness(a.businessId, { now: new Date(Date.now() + 1000) });
    expect(of("/rewards/release")).toHaveLength(0);
    const ev = (await events(a, "RELEASE")).find((e) => e.refId === usedId)!;
    expect(ev).toMatchObject({ status: "SENT", lastError: "The reward was used on a paid bill." });
  });
});
