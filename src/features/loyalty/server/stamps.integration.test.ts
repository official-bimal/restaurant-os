import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createOrder, addItem, previewBill, checkout } from "@/features/orders/server/service";
import { refundInvoice } from "@/features/orders/server/void";
import { attachCustomerToOrder } from "./customers";
import { deleteStampProgram, getStampOptions, listStampPrograms, saveStampProgram, setStampProgramActive, stampStatus } from "./stamps";

const stamp = Date.now();
let n = 0;
const key = () => `st-${stamp}-${++n}`;
let owner: TenantContext;
let cashier: TenantContext;
let waiter: TenantContext;
let businessId: string;
let latte: string;
let fries: string;
let coffeeCat: string;
let customerId: string;
let programId: string;
const PHONE = "9841112233";

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `st-${stamp}@it.test`, name: "ST", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-st-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  coffeeCat = (await db.menuCategory.create({ data: { businessId, name: "Coffee" } })).id;
  const snackCat = (await db.menuCategory.create({ data: { businessId, name: "Snack" } })).id;
  latte = (await db.menuItem.create({ data: { businessId, categoryId: coffeeCat, name: "Latte", price: 20_000 } })).id;
  fries = (await db.menuItem.create({ data: { businessId, categoryId: snackCat, name: "Fries", price: 18_000 } })).id;
  const base = { userId: user.id, businessId, branchId: branch.id, branchIds: [branch.id] };
  owner = { ...base, role: "OWNER" };
  cashier = { ...base, role: "CASHIER" };
  waiter = { ...base, role: "WAITER" };
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.stampRedemption.deleteMany({ where: { businessId } });
  await db.stampProgramItem.deleteMany({ where: { businessId } });
  await db.stampProgram.deleteMany({ where: { businessId } });
  await db.printJob.deleteMany({ where: { businessId } });
  await db.refundPayment.deleteMany({ where: { businessId } });
  await db.creditNote.deleteMany({ where: { businessId } });
  await db.payment.deleteMany({ where: { businessId } });
  await db.invoice.deleteMany({ where: { businessId } });
  await db.orderItem.deleteMany({ where: { businessId } });
  await db.order.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

/** A bill for the customer: one dish, paid in cash, optionally using a stamp card. */
async function bill(dish: string, use?: { programId: string }) {
  const o = await createOrder(cashier, { type: "TAKEAWAY", idempotencyKey: key() });
  const c = await attachCustomerToOrder(cashier, o.id, { phone: PHONE, name: "Sita" });
  customerId = c.id;
  await addItem(cashier, o.id, { menuItemId: dish, quantity: 1 });
  const stampArg = use ? { programId: use.programId } : null;
  const t = await previewBill(cashier, o.id, { kind: "none" }, 0, null, stampArg);
  const inv = await checkout(cashier, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }], stampProgramId: use?.programId });
  return { o, t, inv };
}

describe("stamp cards", () => {
  it("counts stamps from paid bills of the qualifying category only", async () => {
    programId = (await saveStampProgram(owner, { name: "Coffee card", target: 3, items: [{ menuItemId: null, categoryId: coffeeCat }] })).id;
    await bill(latte);
    await bill(fries); // not coffee: no stamp
    await bill(latte);
    const [card] = await stampStatus(db, businessId, customerId);
    expect(card).toMatchObject({ name: "Coffee card" });
    expect(card!.card).toMatchObject({ stamps: 2, available: 0, toGo: 1 });
  });

  it("refuses a free dish before the card is full, then gives one when it is", async () => {
    const o = await createOrder(cashier, { type: "TAKEAWAY", idempotencyKey: key() });
    await attachCustomerToOrder(cashier, o.id, { phone: PHONE });
    await addItem(cashier, o.id, { menuItemId: latte, quantity: 1 });
    await expect(previewBill(cashier, o.id, { kind: "none" }, 0, null, { programId })).rejects.toThrow(/not full yet: 1 more/);
    await bill(latte); // the third coffee fills the card
    const o2 = await createOrder(cashier, { type: "TAKEAWAY", idempotencyKey: key() });
    await attachCustomerToOrder(cashier, o2.id, { phone: PHONE });
    await addItem(cashier, o2.id, { menuItemId: latte, quantity: 1 });
    await addItem(cashier, o2.id, { menuItemId: fries, quantity: 1 });
    const options = (await getStampOptions(cashier, o2.id))!;
    expect(options.programs[0]!.card.available).toBe(1);
    expect(options.programs[0]!.eligible.map((e) => e.name)).toEqual(["Latte"]); // fries are not covered
    const plain = await previewBill(cashier, o2.id, { kind: "none" });
    const free = await previewBill(cashier, o2.id, { kind: "none" }, 0, null, { programId });
    expect(free.stamp).toEqual({ itemName: "Latte", value: 20_000 });
    expect(free.loyaltyDiscount).toBe(20_000);
    expect(free.grandTotal).toBeLessThan(plain.grandTotal);
    const inv = await checkout(cashier, o2.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: free.grandTotal }], stampProgramId: programId });
    expect(inv.loyaltyDiscount).toBe(20_000);
    const used = await db.stampRedemption.findMany({ where: { businessId, customerId } });
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ invoiceId: inv.id, itemName: "Latte", valueMinor: 20_000 });
    // The card starts again: it is not full any more.
    expect((await stampStatus(db, businessId, customerId))[0]!.card.available).toBe(0);
  });

  it("gives the free dish back when the bill that used it is refunded in full", async () => {
    const before = (await stampStatus(db, businessId, customerId))[0]!.card;
    const inv = await db.invoice.findFirstOrThrow({ where: { businessId, loyaltyDiscount: 20_000 } });
    await refundInvoice(owner, inv.id, "wrong order");
    const after = (await stampStatus(db, businessId, customerId))[0]!.card;
    // The refunded bill's coffee no longer earns a stamp, and the free dish it used is back on the card.
    expect(after.redeemed).toBeLessThan(before.redeemed + 1);
    expect(after.stamps).toBe(before.stamps - 1);
    expect(after.available).toBeGreaterThanOrEqual(1);
  });

  it("needs a customer confirmed in person, and a dish the card covers", async () => {
    const o = await createOrder(cashier, { type: "TAKEAWAY", idempotencyKey: key() });
    await attachCustomerToOrder(cashier, o.id, { phone: PHONE });
    await addItem(cashier, o.id, { menuItemId: fries, quantity: 1 });
    await expect(previewBill(cashier, o.id, { kind: "none" }, 0, null, { programId })).rejects.toThrow(/Choose a dish on the bill/);
    await addItem(cashier, o.id, { menuItemId: latte, quantity: 1 });
    await db.order.update({ where: { id: o.id }, data: { customerConfirmed: false } });
    await expect(previewBill(cashier, o.id, { kind: "none" }, 0, null, { programId })).rejects.toThrow(/Confirm in person/);
    const noCustomer = await createOrder(cashier, { type: "TAKEAWAY", idempotencyKey: key() });
    await addItem(cashier, noCustomer.id, { menuItemId: latte, quantity: 1 });
    await expect(previewBill(cashier, noCustomer.id, { kind: "none" }, 0, null, { programId })).rejects.toThrow(/Add a customer/);
    expect(await getStampOptions(cashier, noCustomer.id)).toBeNull();
  });

  it("is set up by owners and managers, a used card is kept, and a switched-off card stops counting", async () => {
    await expect(listStampPrograms(waiter)).rejects.toThrow(/permission/);
    await expect(saveStampProgram(owner, { name: "x", target: 1, items: [] })).rejects.toThrow(/between 2 and 50/);
    await expect(saveStampProgram(owner, { name: "", target: 5, items: [] })).rejects.toThrow(/name/);
    await expect(deleteStampProgram(owner, programId)).rejects.toThrow(/kept for the record/);
    await setStampProgramActive(owner, programId, false);
    expect(await stampStatus(db, businessId, customerId)).toEqual([]);
    const spare = await saveStampProgram(owner, { name: "Spare", target: 5, items: [] });
    await deleteStampProgram(owner, spare.id);
    expect((await listStampPrograms(owner)).some((p) => p.id === spare.id)).toBe(false);
  });
});
