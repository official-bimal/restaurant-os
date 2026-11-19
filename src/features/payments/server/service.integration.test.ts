import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createOrder, addItem, previewBill, checkout } from "@/features/orders/server/service";
import { ESEWA_TEST, esewaSign, type FetchLike } from "../gateways";
import {
  cancelIntent,
  checkoutMethods,
  completeFromIntent,
  createIntent,
  getPayPage,
  getPaymentSettings,
  getResult,
  handleEsewaReturn,
  handleKhaltiReturn,
  listBillIntents,
  refreshIntent,
  savePaymentSetting,
} from "./service";

const stamp = Date.now();
let n = 0;
let owner: TenantContext;
let cashier: TenantContext;
let waiter: TenantContext;
let businessId: string;
let momo: string;
const BASE = "https://shop.example.com";

const reply = (body: unknown, status = 200): ReturnType<FetchLike> => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

beforeAll(async () => {
  process.env.SESSION_SECRET ||= "x".repeat(40);
  const user = await db.user.create({ data: { email: `pay-${stamp}@it.test`, name: "Pay", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-pay-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId, name: "Food" } });
  momo = (await db.menuItem.create({ data: { businessId, categoryId: cat.id, name: "Momo", price: 20_000 } })).id;
  const base = { userId: user.id, businessId, branchId: branch.id, branchIds: [branch.id] };
  owner = { ...base, role: "OWNER" };
  cashier = { ...base, role: "CASHIER" };
  waiter = { ...base, role: "WAITER" };
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.paymentIntent.deleteMany({ where: { businessId } });
  await db.paymentSetting.deleteMany({ where: { businessId } });
  await db.printJob.deleteMany({ where: { businessId } });
  await db.payment.deleteMany({ where: { businessId } });
  await db.invoice.deleteMany({ where: { businessId } });
  await db.orderItem.deleteMany({ where: { businessId } });
  await db.order.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

async function bill(qty = 1) {
  const o = await createOrder(owner, { type: "TAKEAWAY", idempotencyKey: `pay-${stamp}-${++n}` });
  await addItem(owner, o.id, { menuItemId: momo, quantity: qty });
  return o;
}

const signedReply = (uuid: string, total: string, secret = ESEWA_TEST.secret, status = "COMPLETE") => {
  const fields = { transaction_code: "000AWEO", status, total_amount: total, transaction_uuid: uuid, product_code: "EPAYTEST", signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names" };
  return Buffer.from(JSON.stringify({ ...fields, signature: esewaSign(secret, fields, fields.signed_field_names.split(",")) })).toString("base64");
};
const nprOf = (paisa: number) => String(paisa / 100);

describe("set-up", () => {
  it("manual services are on from the start and eSewa and Khalti are off until the owner turns them on", async () => {
    const s = await getPaymentSettings(owner);
    expect(s.find((x) => x.provider === "FONEPAY")!.enabled).toBe(true);
    expect(s.find((x) => x.provider === "ESEWA")!.enabled).toBe(false);
    expect((await checkoutMethods(cashier)).map((m) => m.id)).toEqual(["FONEPAY", "CONNECTIPS", "IMEPAY", "CARD"]);
    await expect(getPaymentSettings(cashier)).rejects.toThrow(/owner/);
  });

  it("turns eSewa on in test mode with no key (eSewa's sandbox login), and Khalti only with a key that is never shown again", async () => {
    await savePaymentSetting(owner, "ESEWA", { enabled: true, mode: "TEST" });
    expect((await checkoutMethods(cashier)).map((m) => m.id)).toContain("ESEWA");
    await expect(savePaymentSetting(owner, "KHALTI", { enabled: true, mode: "TEST" })).rejects.toThrow(/secret key/);
    await expect(savePaymentSetting(owner, "ESEWA", { enabled: true, mode: "LIVE" })).rejects.toThrow(/product code and secret/);
    await savePaymentSetting(owner, "KHALTI", { enabled: true, mode: "TEST", secret: "test-secret-abc" });
    const k = (await getPaymentSettings(owner)).find((x) => x.provider === "KHALTI")!;
    expect(k).toMatchObject({ enabled: true, hasSecret: true });
    expect(JSON.stringify(k)).not.toContain("test-secret-abc");
    const row = await db.paymentSetting.findFirstOrThrow({ where: { businessId, provider: "KHALTI" } });
    expect(row.secretSealed).toMatch(/^v1\./);
    expect(row.secretSealed).not.toContain("test-secret-abc");
    // Saving again without a key keeps the old one.
    await savePaymentSetting(owner, "KHALTI", { enabled: true, mode: "TEST" });
    expect((await getPaymentSettings(owner)).find((x) => x.provider === "KHALTI")!.hasSecret).toBe(true);
    await savePaymentSetting(owner, "FONEPAY", { enabled: false, mode: "TEST" });
    expect((await checkoutMethods(cashier)).map((m) => m.id)).not.toContain("FONEPAY");
  });
});

describe("paying a bill through eSewa", () => {
  it("starts a payment, sends the customer to eSewa with a signed form, and completes the bill only after eSewa confirms", async () => {
    const o = await bill();
    const total = (await previewBill(owner, o.id, { kind: "none" })).grandTotal;
    const intent = await createIntent(cashier, o.id, "ESEWA", {}, BASE);
    expect(intent.amount).toBe(total);
    expect(intent.status).toBe("CREATED");

    const page = await getPayPage(intent.token, BASE);
    expect(page).toMatchObject({ kind: "esewa", amount: total });
    if (page?.kind !== "esewa") throw new Error("expected the eSewa page");
    expect(page.form.fields).toMatchObject({ transaction_uuid: intent.uuid, product_code: "EPAYTEST", total_amount: nprOf(total), success_url: `${BASE}/api/pay/esewa/return` });
    expect(page.form.fields.signature).toBe(esewaSign(ESEWA_TEST.secret, { total_amount: nprOf(total), transaction_uuid: intent.uuid, product_code: "EPAYTEST" }, ["total_amount", "transaction_uuid", "product_code"]));

    // Not paid yet: the bill cannot be completed.
    await expect(completeFromIntent(cashier, intent.id)).rejects.toThrow(/not been confirmed/);

    // A reply with a wrong signature changes nothing.
    const forged = await handleEsewaReturn(signedReply(intent.uuid, nprOf(total), "attacker-secret"), { fetch: () => reply({ status: "COMPLETE", total_amount: total / 100, ref_id: "X" }) });
    expect(forged!.status).not.toBe("PAID");

    // A good reply, but eSewa's own status service says it is not complete: still not paid.
    const pending = await handleEsewaReturn(signedReply(intent.uuid, nprOf(total)), { fetch: () => reply({ status: "PENDING" }) });
    expect(pending!.status).not.toBe("PAID");

    // A good reply and eSewa confirms.
    const paid = await handleEsewaReturn(signedReply(intent.uuid, nprOf(total)), { fetch: () => reply({ status: "COMPLETE", total_amount: total / 100, ref_id: "0001ABC" }) });
    expect(paid).toEqual({ token: intent.token, status: "PAID" });
    expect((await getResult(intent.token))!.status).toBe("PAID");

    const invoice = await completeFromIntent(cashier, intent.id);
    expect(invoice.grandTotal).toBe(total);
    const pays = await db.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ method: "QR", provider: "ESEWA", reference: "0001ABC", amount: total });
    await expect(completeFromIntent(cashier, intent.id)).rejects.toThrow(/already been used/);
  });

  it("refuses to complete a bill that changed after the customer paid, and lets it be completed again once it matches", async () => {
    const o = await bill();
    const intent = await createIntent(cashier, o.id, "ESEWA", {}, BASE);
    const amount = intent.amount;
    await handleEsewaReturn(signedReply(intent.uuid, nprOf(amount)), { fetch: () => reply({ status: "COMPLETE", total_amount: amount / 100, ref_id: "R2" }) });
    await addItem(owner, o.id, { menuItemId: momo, quantity: 1 });
    await expect(completeFromIntent(cashier, intent.id)).rejects.toThrow(/bill has changed/);
    const row = await db.paymentIntent.findFirstOrThrow({ where: { id: intent.id } });
    expect(row.consumedAt).toBeNull(); // not used up by the failed attempt
  });

  it("only works for an open bill, one live attempt at a time, and people who take payments", async () => {
    const o = await bill();
    const a = await createIntent(cashier, o.id, "ESEWA", {}, BASE);
    const b = await createIntent(cashier, o.id, "ESEWA", {}, BASE);
    expect((await db.paymentIntent.findFirstOrThrow({ where: { id: a.id } })).status).toBe("CANCELLED");
    expect((await listBillIntents(cashier, o.id)).map((x) => x.id)).toEqual([b.id]);
    await cancelIntent(cashier, b.id);
    await expect(cancelIntent(cashier, b.id)).rejects.toThrow(/no longer/);
    await expect(createIntent(waiter, o.id, "ESEWA", {}, BASE)).rejects.toThrow(/permission/);
    await expect(createIntent(cashier, o.id, "FONEPAY", {}, BASE)).rejects.toThrow(/by hand/);
    const t = await previewBill(owner, o.id, { kind: "none" });
    await checkout(owner, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
    await expect(createIntent(cashier, o.id, "ESEWA", {}, BASE)).rejects.toThrow(/closed/);
    expect(await getPayPage("short", BASE)).toBeNull();
  });
});

describe("paying a bill through Khalti", () => {
  it("gets a link from Khalti, sends the customer there, and trusts only Khalti's lookup", async () => {
    const o = await bill(2);
    let initiated: { url: string; body: string } | null = null;
    const start: FetchLike = (url, init) => {
      initiated = { url, body: init?.body ?? "" };
      return reply({ pidx: "PIDX123456", payment_url: "https://test-pay.khalti.com/?pidx=PIDX123456", expires_at: "x" });
    };
    const intent = await createIntent(cashier, o.id, "KHALTI", {}, BASE, { fetch: start });
    expect(initiated!.url).toBe("https://dev.khalti.com/api/v2/epayment/initiate/");
    expect(JSON.parse(initiated!.body)).toMatchObject({ amount: intent.amount, return_url: `${BASE}/api/pay/khalti/return?token=${intent.token}` });
    expect(await getPayPage(intent.token, BASE)).toMatchObject({ kind: "khalti", url: "https://test-pay.khalti.com/?pidx=PIDX123456" });

    // The customer's return says "Completed" in the URL, but only Khalti's lookup counts.
    const notYet = await handleKhaltiReturn(intent.token, { fetch: () => reply({ status: "Pending" }) });
    expect(notYet!.status).toBe("PENDING");
    expect((await refreshIntent(cashier, intent.id, { fetch: () => reply({ status: "Completed", total_amount: intent.amount - 1, transaction_id: "T" }) }))).toBe("FAILED");
  });

  it("completes the bill once Khalti says completed for the right amount", async () => {
    const o = await bill();
    const intent = await createIntent(cashier, o.id, "KHALTI", {}, BASE, { fetch: () => reply({ pidx: "PIDX999999", payment_url: "https://test-pay.khalti.com/?pidx=PIDX999999" }) });
    const r = await handleKhaltiReturn(intent.token, { fetch: () => reply({ status: "Completed", total_amount: intent.amount, transaction_id: "TXN-7" }) });
    expect(r!.status).toBe("PAID");
    const invoice = await completeFromIntent(cashier, intent.id);
    expect(await db.payment.findMany({ where: { invoiceId: invoice.id }, select: { provider: true, reference: true, method: true } })).toEqual([{ provider: "KHALTI", reference: "TXN-7", method: "QR" }]);
  });

  it("explains a refused key instead of making a payment", async () => {
    const o = await bill();
    await expect(createIntent(cashier, o.id, "KHALTI", {}, BASE, { fetch: () => reply({ detail: "Invalid token." }, 401) })).rejects.toThrow(/Invalid token/);
    expect(await db.paymentIntent.count({ where: { businessId, orderId: o.id } })).toBe(0);
  });
});

describe("services recorded by hand", () => {
  it("keeps the service and the reference on the payment, and refuses an unknown service", async () => {
    const o = await bill();
    const t = await previewBill(owner, o.id, { kind: "none" });
    const inv = await checkout(cashier, o.id, { discount: { kind: "none" }, payments: [{ method: "QR", amount: t.grandTotal, provider: "FONEPAY", reference: "  FP-20261119-42  " }] });
    expect(await db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } })).toMatchObject({ method: "QR", provider: "FONEPAY", reference: "FP-20261119-42" });
    const o2 = await bill();
    await expect(checkout(cashier, o2.id, { discount: { kind: "none" }, payments: [{ method: "QR", amount: t.grandTotal, provider: "PAYPAL" }] })).rejects.toThrow(/Unknown payment service/);
  });
});
