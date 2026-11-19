import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createOrder, addItem, previewBill, checkout } from "@/features/orders/server/service";
import { refundInvoice } from "@/features/orders/server/void";
import { getReceipt } from "@/features/printing/server/documents";
import { createSupplier } from "@/features/purchasing/server/service";
import { createBill } from "@/features/purchasing/server/bills";
import { localDate } from "@/lib/business-day";
import { booksCsv, getAuditTrail, getPurchaseBook, getSalesBook, getVatSummary } from "./registers";
import { getBalanceSheet, syncPostings } from "./service";

const stamp = Date.now();
let n = 0;
const key = () => `reg-${stamp}-${++n}`;
let owner: TenantContext;
let cashier: TenantContext;
let businessId: string;
let momo: string;
let today: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `reg-${stamp}@it.test`, name: "Reg", passwordHash: "x" } });
  const biz = await db.business.create({
    data: { name: `itest-reg-${stamp}`, panNumber: "123456789", memberships: { create: { userId: user.id, role: "OWNER" } } },
  });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId, name: "Food" } });
  momo = (await db.menuItem.create({ data: { businessId, categoryId: cat.id, name: "Momo", price: 20_000 } })).id;
  const base = { userId: user.id, businessId, branchId: branch.id, branchIds: [branch.id] };
  owner = { ...base, role: "OWNER" };
  cashier = { ...base, role: "CASHIER" };
  today = localDate(new Date(), biz.timezone);
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.journalLine.deleteMany({ where: { businessId } });
  await db.journalEntry.deleteMany({ where: { businessId } });
  await db.account.deleteMany({ where: { businessId } });
  await db.supplierPayment.deleteMany({ where: { businessId } });
  await db.supplierBill.deleteMany({ where: { businessId } });
  await db.printJob.deleteMany({ where: { businessId } });
  await db.payment.deleteMany({ where: { businessId } });
  await db.refundPayment.deleteMany({ where: { businessId } });
  await db.creditNote.deleteMany({ where: { businessId } });
  await db.invoice.deleteMany({ where: { businessId } });
  await db.orderItemAddOn.deleteMany({ where: { businessId } });
  await db.orderItem.deleteMany({ where: { businessId } });
  await db.order.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

async function sale(buyer?: { buyerName?: string; buyerPan?: string }) {
  const order = await createOrder(owner, { type: "TAKEAWAY", idempotencyKey: key() });
  await addItem(owner, order.id, { menuItemId: momo, quantity: 2 });
  const t = await previewBill(owner, order.id, { kind: "none" });
  const inv = await checkout(owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }], ...buyer });
  return { inv, total: t.grandTotal };
}

describe("IRD bill format", () => {
  it("prints the original once, then marks every reprint as a copy", async () => {
    const { inv } = await sale();
    const first = await getReceipt(owner, inv.id);
    expect(first.copy).toBeNull();
    expect(first.label).toMatch(/^\d{4}\/\d{2}-\d+$/);
    expect(first.bsDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const second = await getReceipt(owner, inv.id);
    expect(second.copy).toBe("COPY OF ORIGINAL (reprint 1)");
    expect((await getReceipt(owner, inv.id)).copy).toBe("COPY OF ORIGINAL (reprint 2)");
    expect((await db.invoice.findFirstOrThrow({ where: { id: inv.id } })).printCount).toBe(3);
  });

  it("puts the buyer name and PAN on the bill, and refuses a bad PAN", async () => {
    const { inv } = await sale({ buyerName: "Hotel Everest Pvt Ltd", buyerPan: "987654321" });
    const r = await getReceipt(owner, inv.id);
    expect([r.invoice.buyerName, r.invoice.buyerPan]).toEqual(["Hotel Everest Pvt Ltd", "987654321"]);
    const order = await createOrder(owner, { type: "TAKEAWAY", idempotencyKey: key() });
    await addItem(owner, order.id, { menuItemId: momo, quantity: 1 });
    const t = await previewBill(owner, order.id, { kind: "none" });
    await expect(checkout(owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }], buyerPan: "12" })).rejects.toThrow(/nine digits/);
    await expect(checkout(owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }], buyerPan: "123456789" })).rejects.toThrow(/buyer name/);
    expect(await db.invoice.count({ where: { orderId: order.id } })).toBe(0);
  });
});

describe("the sales book, purchase book and VAT summary", () => {
  it("lists every bill, shows a refund as a negative row, and the columns add up", async () => {
    const { inv } = await sale({ buyerName: "Acme", buyerPan: "111222333" });
    await refundInvoice(owner, inv.id, "wrong order");
    const { rows, totals } = await getSalesBook(owner, today, today);
    expect(rows.some((r) => r.kind === "INVOICE" && r.pan === "111222333")).toBe(true);
    const cn = rows.find((r) => r.kind === "CREDIT_NOTE")!;
    expect(cn.total).toBeLessThan(0);
    expect(cn.note).toMatch(/^For invoice /);
    for (const r of rows) expect(r.taxable + r.nonTaxable + r.vat).toBe(r.total);
    expect(totals.total).toBe(rows.reduce((s, r) => s + r.total, 0));
  });

  it("includes supplier bills with their VAT, and the summary nets input from output VAT", async () => {
    const s = await createSupplier(owner, { name: "Fresh Veg", panNumber: "555666777" });
    await createBill(owner, { supplierId: s.id, number: "B-1", billDate: today, amount: 11_300, vatAmount: 1_300 });
    await expect(createBill(owner, { supplierId: s.id, billDate: today, amount: 1_000, vatAmount: 1_000 })).rejects.toThrow(/VAT must be less/);
    const book = await getPurchaseBook(owner, today, today);
    expect(book.rows[0]).toMatchObject({ pan: "555666777", total: 11_300, vat: 1_300, taxable: 10_000 });
    const vat = await getVatSummary(owner, today, today);
    expect(vat.totals.inputVat).toBe(1_300);
    expect(vat.totals.net).toBe(vat.totals.outputVat - 1_300);
    // The VAT paid on a purchase reaches the books too, and they still balance.
    await syncPostings(businessId);
    expect((await getBalanceSheet(owner, today)).difference).toBe(0);
  });

  it("makes a CSV that spreadsheets cannot run as a formula", () => {
    const csv = booksCsv([{ kind: "INVOICE", date: "2026-08-01", bs: "2083-04-16", number: "2083/84-1", name: "=cmd|x", pan: null, total: -1_250, nonTaxable: 0, taxable: -1_106, vat: -144, note: null }], "Buyer");
    expect(csv).toContain("'=cmd|x");
    expect(csv).toContain(",-12.5,");
  });

  it("only owners and managers may read the books and the audit log", async () => {
    await expect(getSalesBook(cashier, today, today)).rejects.toThrow(/permission/);
    await expect(getAuditTrail(cashier, { from: today, to: today })).rejects.toThrow(/permission/);
    const events = await getAuditTrail(owner, { from: today, to: today, action: "print." });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.action.startsWith("print."))).toBe(true);
  });
});
