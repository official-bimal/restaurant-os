import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { addItem, createOrder } from "@/features/orders/server/service";
import { openSession, submitOrder } from "@/features/guest/server/service";
import { ESEWA_TEST, esewaSign, type FetchLike } from "../gateways";
import { getResult, handleEsewaReturn, handleKhaltiReturn, savePaymentSetting } from "./service";
import { checkGuestPayments, guestPayInfo, setGuestPay, startGuestPayment } from "./guest";

const stamp = Date.now();
let n = 0;
const BASE = "https://shop.example.com";
const reply = (body: unknown, status = 200): ReturnType<FetchLike> => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const signedReply = (uuid: string, total: string) => {
  const fields = { transaction_code: "000AWEO", status: "COMPLETE", total_amount: total, transaction_uuid: uuid, product_code: "EPAYTEST", signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names" };
  return Buffer.from(JSON.stringify({ ...fields, signature: esewaSign(ESEWA_TEST.secret, fields, fields.signed_field_names.split(",")) })).toString("base64");
};
const nprOf = (paisa: number) => String(paisa / 100);

async function world(name: string) {
  const user = await db.user.create({ data: { email: `${name}-${stamp}@it.test`, name, passwordHash: "x" } });
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const table = await db.diningTable.create({ data: { businessId: biz.id, branchId: branch.id, areaId: area.id, label: "T1" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", price: 20_000 } });
  const base = { userId: user.id, businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return { biz: biz.id, owner: { ...base, role: "OWNER" } as TenantContext, waiter: { ...base, role: "WAITER" } as TenantContext, table: table.id, tableToken: table.publicToken, areaId: area.id, momo: momo.id, branchId: branch.id };
}
type W = Awaited<ReturnType<typeof world>>;
let a: W;
let b: W;

/** The guest scans the table QR and the waiter puts items on its bill. */
async function seated(w: W, qty = 1) {
  const gc = await openSession(w.tableToken);
  let order = await db.order.findFirst({ where: { businessId: w.biz, tableId: w.table, status: { in: ["OPEN", "SERVED"] } } });
  if (!order) order = await createOrder(w.owner, { type: "DINE_IN", tableId: w.table, idempotencyKey: `gp-${stamp}-${++n}` });
  await addItem(w.owner, order.id, { menuItemId: w.momo, quantity: qty });
  return { gc, order };
}

/** Close the sitting and remove every bill, so a test starts with an empty table. */
async function clearTable(w: W) {
  await db.tableSession.updateMany({ where: { businessId: w.biz, closedAt: null }, data: { closedAt: new Date() } });
  await db.paymentIntent.deleteMany({ where: { businessId: w.biz } });
  await db.payment.deleteMany({ where: { businessId: w.biz } });
  await db.invoice.deleteMany({ where: { businessId: w.biz } });
  await db.guestSubmissionItem.deleteMany({ where: { businessId: w.biz } });
  await db.guestSubmission.deleteMany({ where: { businessId: w.biz } });
  await db.orderItem.deleteMany({ where: { businessId: w.biz } });
  await db.order.deleteMany({ where: { businessId: w.biz } });
}

beforeAll(async () => {
  process.env.SESSION_SECRET ||= "x".repeat(40);
  a = await world(`itest-gpay-a`);
  b = await world(`itest-gpay-b`);
});

afterAll(async () => {
  for (const w of [a, b]) {
    const members = await db.membership.findMany({ where: { businessId: w.biz } });
    await db.paymentIntent.deleteMany({ where: { businessId: w.biz } });
    await db.paymentSetting.deleteMany({ where: { businessId: w.biz } });
    await db.guestSubmissionItem.deleteMany({ where: { businessId: w.biz } });
    await db.guestSubmission.deleteMany({ where: { businessId: w.biz } });
    await db.serviceRequest.deleteMany({ where: { businessId: w.biz } });
    await db.payment.deleteMany({ where: { businessId: w.biz } });
    await db.invoice.deleteMany({ where: { businessId: w.biz } });
    await db.orderItem.deleteMany({ where: { businessId: w.biz } });
    await db.order.deleteMany({ where: { businessId: w.biz } });
    await db.tableSession.deleteMany({ where: { businessId: w.biz } });
    await db.business.delete({ where: { id: w.biz } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("setting it up", () => {
  it("is off to begin with, and cannot be turned on before eSewa or Khalti is ready", async () => {
    const { gc } = await seated(a);
    expect(await guestPayInfo(a.biz, gc.tableId)).toMatchObject({ enabled: false, methods: [] });
    await expect(startGuestPayment(gc, "x", "ESEWA", BASE)).rejects.toThrow(/not available/);
    await expect(setGuestPay(a.waiter, true)).rejects.toThrow(/owner/);
    await expect(setGuestPay(a.owner, true)).rejects.toThrow(/Switch on eSewa or Khalti/);
    await savePaymentSetting(a.owner, "ESEWA", { enabled: true, mode: "TEST" });
    await setGuestPay(a.owner, true);
    const info = await guestPayInfo(a.biz, gc.tableId);
    expect(info).toMatchObject({ enabled: true, methods: [{ id: "ESEWA", label: "eSewa" }], inProgress: [], waitingForStaff: false });
    expect((await db.business.findUniqueOrThrow({ where: { id: b.biz } })).guestPayEnabled).toBe(false);
    expect(await guestPayInfo(b.biz, b.table)).toMatchObject({ enabled: false });
  });
});

describe("a guest paying their own bill", () => {
  it("pays with eSewa and the bill closes by itself, once, for the right amount", async () => {
    await clearTable(a);
    const { gc, order } = await seated(a, 2);
    const { token } = await startGuestPayment(gc, order.id, "ESEWA", BASE);
    const intent = await db.paymentIntent.findUniqueOrThrow({ where: { token } });
    expect(intent).toMatchObject({ byGuest: true, provider: "ESEWA", orderId: order.id, createdById: "guest-pay" });
    expect(intent.amount).toBeGreaterThan(40_000); // 2 x Rs 200 plus service charge and VAT, worked out on the server
    expect(await db.auditEvent.count({ where: { businessId: a.biz, action: "payments.guestStart" } })).toBe(1);

    const paid = await handleEsewaReturn(signedReply(intent.uuid, nprOf(intent.amount)), { fetch: () => reply({ status: "COMPLETE", total_amount: intent.amount / 100, ref_id: "REF-9" }) });
    expect(paid).toEqual({ token, status: "PAID" });
    const closed = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { invoice: { include: { payments: true } } } });
    expect(closed.status).toBe("PAID");
    expect(closed.invoice!.grandTotal).toBe(intent.amount);
    expect(closed.invoice!.payments).toMatchObject([{ method: "QR", provider: "ESEWA", reference: "REF-9", amount: intent.amount }]);
    expect((await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).consumedAt).not.toBeNull();
    // The table is freed and the guest's sitting is over; the guest is offered the way back to the table page.
    expect((await db.tableSession.findFirstOrThrow({ where: { id: gc.sessionId } })).closedAt).not.toBeNull();
    expect((await db.diningTable.findUniqueOrThrow({ where: { id: a.table } })).state).toBe("FREE");
    expect(await getResult(token)).toMatchObject({ status: "PAID", back: `/t/${a.tableToken}` });
    // A second confirmation (the guest's page and the return both arrive) changes nothing and makes no second invoice.
    await handleEsewaReturn(signedReply(intent.uuid, nprOf(intent.amount)), { fetch: () => reply({ status: "COMPLETE", total_amount: intent.amount / 100, ref_id: "REF-9" }) });
    expect(await db.invoice.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("pays with Khalti too, and the guest's open page can confirm it if they never came back", async () => {
    await savePaymentSetting(a.owner, "KHALTI", { enabled: true, mode: "TEST", secret: "test-secret-abc" });
    const { gc, order } = await seated(a);
    const { token } = await startGuestPayment(gc, order.id, "KHALTI", BASE, { fetch: () => reply({ pidx: `PIDX${++n}000000`, payment_url: "https://test-pay.khalti.com/?pidx=X" }) });
    const intent = await db.paymentIntent.findUniqueOrThrow({ where: { token } });
    // Nothing to check until the guest has opened the pay page (CREATED); then the page asks Khalti about it.
    await checkGuestPayments(gc, { fetch: () => reply({ status: "Completed", total_amount: intent.amount, transaction_id: "T1" }) });
    expect((await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).status).toBe("CREATED");
    await db.paymentIntent.update({ where: { id: intent.id }, data: { status: "PENDING" } });
    await checkGuestPayments(gc, { fetch: () => reply({ status: "Completed", total_amount: intent.amount, transaction_id: "T1" }) });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    expect((await db.payment.findFirstOrThrow({ where: { invoice: { orderId: order.id } } })).reference).toBe("T1");
  });

  it("does not close a bill when Khalti says the amount was wrong", async () => {
    const { gc, order } = await seated(a);
    const { token } = await startGuestPayment(gc, order.id, "KHALTI", BASE, { fetch: () => reply({ pidx: `PIDX${++n}000000`, payment_url: "https://test-pay.khalti.com/?pidx=Y" }) });
    const r = await handleKhaltiReturn(token, { fetch: () => reply({ status: "Completed", total_amount: 1, transaction_id: "TX" }) });
    expect(r!.status).toBe("FAILED");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).not.toBe("PAID");
    await db.tableSession.updateMany({ where: { businessId: a.biz, closedAt: null }, data: { closedAt: new Date() } });
  });

  it("leaves a paid bill open, for staff to settle, when an item was added after the payment started", async () => {
    const { gc, order } = await seated(a);
    const { token } = await startGuestPayment(gc, order.id, "ESEWA", BASE);
    const intent = await db.paymentIntent.findUniqueOrThrow({ where: { token } });
    await addItem(a.owner, order.id, { menuItemId: a.momo, quantity: 1 }); // the bill changed
    await handleEsewaReturn(signedReply(intent.uuid, nprOf(intent.amount)), { fetch: () => reply({ status: "COMPLETE", total_amount: intent.amount / 100, ref_id: "REF-LATE" }) });
    const row = await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(row.status).toBe("PAID");
    expect(row.consumedAt).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).not.toBe("PAID");
  });
});

describe("what a guest may not do", () => {
  it("cannot pay someone else's bill, a bill at another table, or a bill from another business", async () => {
    const mine = await seated(a);
    const other = await seated(b);
    await expect(startGuestPayment(mine.gc, other.order.id, "ESEWA", BASE)).rejects.toThrow(/not open/);
    await expect(startGuestPayment(other.gc, mine.order.id, "ESEWA", BASE)).rejects.toThrow(/disabled|not available|not open/);
    // Second table in the same business.
    const t2 = await db.diningTable.create({ data: { businessId: a.biz, branchId: a.branchId, areaId: a.areaId, label: "T2" } });
    const gc2 = await openSession(t2.publicToken);
    await expect(startGuestPayment(gc2, mine.order.id, "ESEWA", BASE)).rejects.toThrow(/not open/);
    await expect(startGuestPayment(mine.gc, mine.order.id, "FONEPAY", BASE)).rejects.toThrow(/eSewa or Khalti/);
  });

  it("cannot pay while their latest order is still waiting for the staff, or on an empty bill", async () => {
    await clearTable(a);
    const gc = await openSession(a.tableToken);
    const o = await createOrder(a.owner, { type: "DINE_IN", tableId: a.table, idempotencyKey: `gp-${stamp}-${++n}` });
    await expect(startGuestPayment(gc, o.id, "ESEWA", BASE)).rejects.toThrow(/nothing on this bill/);
    await addItem(a.owner, o.id, { menuItemId: a.momo, quantity: 1 });
    await submitOrder(gc, { idempotencyKey: `sub-${stamp}-${++n}-abcdefgh`, items: [{ menuItemId: a.momo, quantity: 1 }] });
    expect((await guestPayInfo(a.biz, gc.tableId)).waitingForStaff).toBe(true);
    await expect(startGuestPayment(gc, o.id, "ESEWA", BASE)).rejects.toThrow(/waiting for the staff/);
  });

  it("cannot keep starting payments", async () => {
    await db.guestSubmission.updateMany({ where: { businessId: a.biz }, data: { status: "REJECTED" } });
    const gc = await openSession(a.tableToken);
    const o = await db.order.findFirstOrThrow({ where: { businessId: a.biz, status: { in: ["OPEN", "SERVED"] } } });
    for (let i = 0; i < 5; i++) await startGuestPayment(gc, o.id, "ESEWA", BASE);
    await expect(startGuestPayment(gc, o.id, "ESEWA", BASE)).rejects.toThrow(/Too many tries/);
  });

  it("stops being offered when the owner turns it off", async () => {
    await setGuestPay(a.owner, false);
    const gc = await openSession(a.tableToken);
    expect(await guestPayInfo(a.biz, gc.tableId)).toMatchObject({ enabled: false });
    const o = await db.order.findFirstOrThrow({ where: { businessId: a.biz, status: { in: ["OPEN", "SERVED"] } } });
    await expect(startGuestPayment(gc, o.id, "ESEWA", BASE)).rejects.toThrow(/not available/);
  });
});
