import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { addItem, checkout, createOrder, previewBill } from "@/features/orders/server/service";
import { acceptSubmission, attachGuestCustomer, getGuestView, getSettledSummary, openSession, requestService, submitOrder } from "@/features/guest/server/service";
import {
  adjustPoints,
  attachCustomerToOrder,
  confirmOrderCustomer,
  deleteCustomer,
  detachCustomerFromOrder,
  getCustomer,
  listCustomers,
  setLoyaltySettings,
  updateCustomer,
} from "./customers";

const stamp = Date.now();
const businessIds: string[] = [];

interface World {
  owner: TenantContext;
  cashier: TenantContext;
  waiter: TenantContext;
  areaId: string;
  momo: string;
  token: string;
  tableId: string;
}

let tableCounter = 0;

/** A separate table, so a test gets its own guest sitting. */
async function freshTable(w: World) {
  const t = await db.diningTable.create({
    data: { businessId: w.owner.businessId, branchId: w.owner.branchId, areaId: w.areaId, label: `G${++tableCounter}-${Math.random().toString(36).slice(2, 6)}` },
  });
  return t.publicToken;
}
async function makeWorld(name: string): Promise<World> {
  const user = await db.user.create({ data: { email: `${name}-${stamp}@it.test`, name, passwordHash: "x" } });
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main branch" } });
  businessIds.push(biz.id);
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const table = await db.diningTable.create({ data: { businessId: biz.id, branchId: branch.id, areaId: area.id, label: "T1" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", price: 20_000 } });
  const base = { userId: user.id, businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, role: "OWNER" },
    cashier: { ...base, role: "CASHIER" },
    waiter: { ...base, role: "WAITER" },
    areaId: area.id,
    momo: momo.id,
    token: table.publicToken,
    tableId: table.id,
  };
}

/** An order for 5 momo (Rs 1000 before charges) on a fresh table. */
async function newOrder(w: World, qty = 5) {
  const table = await db.diningTable.create({
    data: { businessId: w.owner.businessId, branchId: w.owner.branchId, areaId: w.areaId, label: `X${++tableCounter}-${Math.random().toString(36).slice(2, 6)}` },
  });
  const order = await createOrder(w.owner, { type: "DINE_IN", tableId: table.id, idempotencyKey: `loy-${stamp}-${tableCounter}-${Math.random().toString(36).slice(2)}` });
  await addItem(w.owner, order.id, { menuItemId: w.momo, quantity: qty });
  return order;
}

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-loy-a");
  b = await makeWorld("itest-loy-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
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

const PHONE = "9812345678";
const E164 = "+9779812345678";

describe("attaching a customer at the counter", () => {
  it("normalises every spelling of a number to one customer", async () => {
    const o1 = await newOrder(a);
    const o2 = await newOrder(a);
    const c1 = await attachCustomerToOrder(a.cashier, o1.id, { phone: PHONE, name: "  Sita  Rai " });
    const c2 = await attachCustomerToOrder(a.cashier, o2.id, { phone: "+977 98-1234-5678", name: "Someone Else" });
    expect(c2.id).toBe(c1.id);
    expect(c1.phone).toBe(E164);
    expect(c2.name).toBe("Sita Rai"); // never overwritten by a later spelling
    const order = await db.order.findUniqueOrThrow({ where: { id: o1.id } });
    expect(order).toMatchObject({ customerId: c1.id, customerConfirmed: true });
  });

  it("rejects bad numbers and roles that may not use customers", async () => {
    const o = await newOrder(a);
    await expect(attachCustomerToOrder(a.cashier, o.id, { phone: "12" })).rejects.toThrow("valid phone");
    await expect(attachCustomerToOrder(a.waiter, o.id, { phone: PHONE })).rejects.toThrow("permission");
  });

  it("keeps businesses apart: same number, separate customers, no cross access", async () => {
    const oA = await newOrder(a);
    const oB = await newOrder(b);
    const cA = await attachCustomerToOrder(a.cashier, oA.id, { phone: PHONE });
    const cB = await attachCustomerToOrder(b.cashier, oB.id, { phone: PHONE });
    expect(cB.id).not.toBe(cA.id);
    await expect(attachCustomerToOrder(b.cashier, oA.id, { phone: PHONE })).rejects.toThrow("Order not found");
    await expect(confirmOrderCustomer(b.cashier, oA.id)).rejects.toThrow("Order not found");
    await expect(detachCustomerFromOrder(b.cashier, oA.id)).rejects.toThrow("Order not found");
    await expect(getCustomer(b.owner, cA.id)).rejects.toThrow("not found");
    await expect(updateCustomer(b.owner, cA.id, { marketingConsent: true })).rejects.toThrow("not found");
    await expect(adjustPoints(b.owner, cA.id, { points: 10, reason: "hack" })).rejects.toThrow("not found");
    await expect(deleteCustomer(b.owner, cA.id)).rejects.toThrow("not found");
    expect((await listCustomers(b.owner)).every((c) => c.businessId === b.owner.businessId)).toBe(true);
  });
});

describe("earning at checkout", () => {
  it("awards points on the final bill and records the visit", async () => {
    const o = await newOrder(a); // Rs 1000 -> +10% -> +13% VAT = 1243 final
    const c = await attachCustomerToOrder(a.cashier, o.id, { phone: "9801111111", name: "Earner" });
    const preview = await previewBill(a.cashier, o.id, { kind: "none" });
    expect(preview.grandTotal).toBe(124_300);
    expect(preview.pointsToEarn).toBe(124);
    const invoice = await checkout(a.cashier, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 124_300 }] });
    expect(invoice).toMatchObject({ customerId: c.id, pointsEarned: 124, pointsRedeemed: 0, loyaltyDiscount: 0 });
    const after = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(after).toMatchObject({ pointsBalance: 124, visitCount: 1, totalSpend: 124_300 });
    expect(after.lastVisitAt).not.toBeNull();
    const entries = await db.loyaltyEntry.findMany({ where: { customerId: c.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "EARN", points: 124, invoiceId: invoice.id });
  });

  it("gives nothing when there is no customer, or loyalty is switched off", async () => {
    const plain = await newOrder(a);
    const inv = await checkout(a.cashier, plain.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 124_300 }] });
    expect(inv).toMatchObject({ customerId: null, pointsEarned: 0 });

    await setLoyaltySettings(a.owner, { enabled: false, pointsPer100: 10, redeemPoints: 100, redeemValue: 5_000 });
    const o = await newOrder(a);
    const c = await attachCustomerToOrder(a.cashier, o.id, { phone: "9802222222" });
    const inv2 = await checkout(a.cashier, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 124_300 }] });
    expect(inv2.pointsEarned).toBe(0);
    const after = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(after).toMatchObject({ pointsBalance: 0, visitCount: 1 }); // the visit is still recorded
    await setLoyaltySettings(a.owner, { enabled: true, pointsPer100: 10, redeemPoints: 100, redeemValue: 5_000 });
  });
});

describe("redeeming points", () => {
  let customerId: string;

  beforeAll(async () => {
    const o = await newOrder(a, 1);
    const c = await attachCustomerToOrder(a.cashier, o.id, { phone: "9803333333", name: "Spender" });
    customerId = c.id;
    await adjustPoints(a.owner, c.id, { points: 350, reason: "starting balance for test" });
    await db.order.update({ where: { id: o.id }, data: { status: "CANCELLED" } }); // retire the helper order
  });

  it("takes the reward off before service charge and VAT, and spends the points", async () => {
    const o = await newOrder(a); // Rs 1000
    await attachCustomerToOrder(a.cashier, o.id, { phone: "9803333333" });
    // Rs 1000 - reward 50 = 950 -> +95 = 1045 -> VAT 135.85 = 1180.85 -> 1181
    const preview = await previewBill(a.cashier, o.id, { kind: "none" }, 100);
    expect(preview).toMatchObject({ loyaltyDiscount: 5_000, grandTotal: 118_100, redeemPoints: 100, pointsToEarn: 118 });
    const inv = await checkout(a.cashier, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 118_100 }], redeemPoints: 100 });
    expect(inv).toMatchObject({ loyaltyDiscount: 5_000, pointsRedeemed: 100, pointsEarned: 118, grandTotal: 118_100 });
    const c = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(c.pointsBalance).toBe(350 - 100 + 118);
  });

  it("keeps the cached balance equal to the ledger", async () => {
    const sum = await db.loyaltyEntry.aggregate({ where: { customerId }, _sum: { points: true } });
    const c = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(c.pointsBalance).toBe(sum._sum.points);
  });

  it("refuses partial blocks, too many points, and a reward bigger than the bill", async () => {
    const o = await newOrder(a, 1); // Rs 200
    await attachCustomerToOrder(a.cashier, o.id, { phone: "9803333333" });
    await expect(previewBill(a.cashier, o.id, { kind: "none" }, 150)).rejects.toThrow("blocks of 100");
    await expect(previewBill(a.cashier, o.id, { kind: "none" }, 100_000)).rejects.toThrow(/enough points|blocks/);
    await expect(previewBill(a.cashier, o.id, { kind: "none" }, 300)).resolves.toBeTruthy(); // Rs 150 off a Rs 200 bill is fine
    await adjustPoints(a.owner, customerId, { points: 1000, reason: "enough for a big reward" });
    await expect(previewBill(a.cashier, o.id, { kind: "none" }, 500)).rejects.toThrow("larger than the bill"); // Rs 250 off a Rs 200 bill
  });

  it("requires a confirmed customer: a number typed by a guest cannot spend points", async () => {
    const o = await newOrder(a);
    await db.order.update({ where: { id: o.id }, data: { customerId, customerConfirmed: false } }); // as if a guest typed it
    await expect(previewBill(a.cashier, o.id, { kind: "none" }, 100)).rejects.toThrow("Confirm in person");
    await expect(checkout(a.cashier, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 1 }], redeemPoints: 100 })).rejects.toThrow("Confirm in person");
    await confirmOrderCustomer(a.cashier, o.id);
    await expect(previewBill(a.cashier, o.id, { kind: "none" }, 100)).resolves.toBeTruthy();
  });

  it("needs a customer on the order and loyalty switched on", async () => {
    const o = await newOrder(a);
    await expect(previewBill(a.cashier, o.id, { kind: "none" }, 100)).rejects.toThrow("Add a customer");
    await attachCustomerToOrder(a.cashier, o.id, { phone: "9803333333" });
    await setLoyaltySettings(a.owner, { enabled: false, pointsPer100: 10, redeemPoints: 100, redeemValue: 5_000 });
    await expect(previewBill(a.cashier, o.id, { kind: "none" }, 100)).rejects.toThrow("switched off");
    await setLoyaltySettings(a.owner, { enabled: true, pointsPer100: 10, redeemPoints: 100, redeemValue: 5_000 });
  });

  it("will not let a failed checkout spend points", async () => {
    const before = (await db.customer.findUniqueOrThrow({ where: { id: customerId } })).pointsBalance;
    const o = await newOrder(a);
    await attachCustomerToOrder(a.cashier, o.id, { phone: "9803333333" });
    await expect(
      checkout(a.cashier, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 1 }], redeemPoints: 100 }),
    ).rejects.toThrow("add up");
    expect((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).pointsBalance).toBe(before);
  });
});

describe("management", () => {
  it("adjusts points with a reason, never below zero, and only for owner or manager", async () => {
    const o = await newOrder(a, 1);
    const c = await attachCustomerToOrder(a.cashier, o.id, { phone: "9804444444" });
    await expect(adjustPoints(a.cashier, c.id, { points: 10, reason: "free points" })).rejects.toThrow("permission");
    await expect(adjustPoints(a.owner, c.id, { points: 10, reason: " " })).rejects.toThrow("reason");
    await expect(adjustPoints(a.owner, c.id, { points: 0, reason: "nothing" })).rejects.toThrow("whole number");
    await expect(adjustPoints(a.owner, c.id, { points: -5, reason: "too much" })).rejects.toThrow("below zero");
    await adjustPoints(a.owner, c.id, { points: 40, reason: "birthday gift" });
    await adjustPoints(a.owner, c.id, { points: -15, reason: "correction" });
    const full = await getCustomer(a.owner, c.id);
    expect(full.pointsBalance).toBe(25);
    expect(full.entries.map((e) => [e.kind, e.points])).toEqual([["ADJUST", -15], ["ADJUST", 40]]);
  });

  it("validates loyalty settings", async () => {
    await expect(setLoyaltySettings(a.owner, { enabled: true, pointsPer100: -1, redeemPoints: 100, redeemValue: 5_000 })).rejects.toThrow("Points per");
    await expect(setLoyaltySettings(a.cashier, { enabled: true, pointsPer100: 10, redeemPoints: 100, redeemValue: 5_000 })).rejects.toThrow("permission");
  });

  it("records consent given by staff as verified, and lets staff withdraw it", async () => {
    const o = await newOrder(a, 1);
    const c = await attachCustomerToOrder(a.cashier, o.id, { phone: "9805555555", marketingConsent: true });
    expect(c).toMatchObject({ marketingConsent: true, consentVerified: true });
    await updateCustomer(a.owner, c.id, { name: "Renamed", marketingConsent: false });
    const after = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(after).toMatchObject({ name: "Renamed", marketingConsent: false, consentVerified: false, consentAt: null });
  });

  it("erases a customer: links are cleared, ledger gone, bills keep their numbers", async () => {
    const o = await newOrder(a);
    const c = await attachCustomerToOrder(a.cashier, o.id, { phone: "9806666666", name: "Erase Me" });
    const inv = await checkout(a.cashier, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 124_300 }] });
    await deleteCustomer(a.owner, c.id);
    expect(await db.customer.findUnique({ where: { id: c.id } })).toBeNull();
    expect(await db.loyaltyEntry.count({ where: { customerId: c.id } })).toBe(0);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(invoice).toMatchObject({ customerId: null, grandTotal: 124_300, pointsEarned: 124 });
    const events = await db.auditEvent.findMany({ where: { businessId: a.owner.businessId, action: "customer.delete" } });
    expect(JSON.stringify(events)).not.toContain("9806666666");
    expect(JSON.stringify(events)).not.toContain("Erase Me");
  });

  it("searches by name or by part of the number", async () => {
    expect((await listCustomers(a.owner, "spender")).map((c) => c.name)).toContain("Spender");
    expect((await listCustomers(a.owner, "98033")).map((c) => c.phone)).toContain("+9779803333333");
    expect(await listCustomers(a.owner, "zzzz-no-match")).toHaveLength(0);
  });
});

describe("guest adds a number from their phone", () => {
  it("earns points for that number without ever being told anything about it", async () => {
    const gc = await openSession(a.token);
    // Make "9807777777" an existing customer with a balance the guest must not learn about.
    const seed = await newOrder(a, 1);
    const existing = await attachCustomerToOrder(a.cashier, seed.id, { phone: "9807777777", name: "Private Person" });
    await adjustPoints(a.owner, existing.id, { points: 777, reason: "seed for privacy test" });

    const asExisting = await attachGuestCustomer(gc, { phone: "9807777777" });
    const asNew = await attachGuestCustomer(gc, { phone: "9808888888" });
    expect(Object.keys(asExisting)).toEqual(Object.keys(asNew)); // same shape either way
    expect(asExisting.maskedPhone).toBe("+977 98••••••77");

    await attachGuestCustomer(gc, { phone: "9807777777" });
    const view = JSON.stringify(await getGuestView(gc));
    expect(view).not.toContain("Private Person");
    expect(view).not.toContain("9807777777");
    expect(view).not.toContain("777");
    expect(JSON.parse(view).loyalty.maskedPhone).toBe("+977 98••••••77");
  });

  it("limits how often a sitting can change the number", async () => {
    const gc = await openSession(b.token);
    await attachGuestCustomer(gc, { phone: "9809000001" });
    await attachGuestCustomer(gc, { phone: "9809000002" });
    await attachGuestCustomer(gc, { phone: "9809000003" });
    await expect(attachGuestCustomer(gc, { phone: "9809000004" })).rejects.toThrow("too many times");
    await expect(attachGuestCustomer(gc, { phone: "bad" })).rejects.toThrow(/valid phone|too many/);
  });

  it("treats guest consent as unverified and lets nobody revoke someone else's consent", async () => {
    const gc = await openSession(await freshTable(a));
    await attachGuestCustomer(gc, { phone: "9806000001", marketingConsent: true });
    let c = await db.customer.findFirstOrThrow({ where: { businessId: a.owner.businessId, phone: "+9779806000001" } });
    expect(c).toMatchObject({ marketingConsent: true, consentVerified: false });
    await updateCustomer(a.owner, c.id, { name: "Verified", marketingConsent: true });
    await attachGuestCustomer(await openSession(await freshTable(a)), { phone: "9806000001", marketingConsent: false }); // a stranger typing it without consent
    c = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(c).toMatchObject({ marketingConsent: true, consentVerified: true });
  });

  it("follows the accepted order unconfirmed, never over a customer staff confirmed, and reports earnings after payment", async () => {
    const w = await makeWorld(`itest-loy-g-${Math.random().toString(36).slice(2, 6)}`);
    const gc = await openSession(w.token);
    await attachGuestCustomer(gc, { phone: "9805000001" });
    const sub = await submitOrder(gc, { items: [{ menuItemId: w.momo, quantity: 5 }], idempotencyKey: "loy-guest-key-1" });
    await acceptSubmission(w.owner, sub.id);
    let order = await db.order.findFirstOrThrow({ where: { businessId: w.owner.businessId } });
    expect(order).toMatchObject({ customerConfirmed: false });
    expect(order.customerId).not.toBeNull();

    // Unconfirmed: points cannot be spent yet.
    await expect(previewBill(w.cashier, order.id, { kind: "none" }, 100)).rejects.toThrow("Confirm in person");

    // Staff attach someone in person; a later guest number must not displace them.
    const staffPick = await attachCustomerToOrder(w.cashier, order.id, { phone: "9805000002" });
    await attachGuestCustomer(gc, { phone: "9805000003" });
    order = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(order).toMatchObject({ customerId: staffPick.id, customerConfirmed: true });

    // The guest's phone says what was earned after payment, but never a balance.
    expect(await getSettledSummary({ sessionId: gc.sessionId, tableId: gc.tableId })).toBeNull(); // still open
    await requestService(gc, "REQUEST_BILL");
    const inv = await checkout(w.cashier, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 124_300 }] });
    const summary = await getSettledSummary({ sessionId: gc.sessionId, tableId: gc.tableId });
    expect(summary).toEqual({ reason: "PAID", pointsEarned: 124, hadCustomer: true });
    expect(inv.pointsEarned).toBe(124);
  });

  it("only reports for the sitting's own table", async () => {
    expect(await getSettledSummary(null)).toBeNull();
    expect(await getSettledSummary({ sessionId: "nope", tableId: "nope" })).toBeNull();
  });
});
