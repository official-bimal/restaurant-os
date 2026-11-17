import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { localDate } from "@/lib/business-day";
import { setPushSender } from "@/features/notifications/server/push";
import { addItem, checkout, createOrder, previewBill } from "@/features/orders/server/service";
import { cancelOrder, refundInvoice } from "@/features/orders/server/void";
import { closeDay } from "@/features/reports/server/service";
import { setProviderForTests, type Provider } from "@/features/messaging/providers";
import { setEmailProviderForTests, type EmailProvider } from "@/features/owner/email";
import { buildSummary, getOwnerSettings, listAlerts, markAlertsSeen, runOwnerChecks, saveOwnerSettings, sendSummaryNow, unseenAlertCount, type OwnerConfigInput } from "./owner";
import { buildAccountantWorkbook } from "./export";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  owner: TenantContext;
  manager: TenantContext;
  waiter: TenantContext;
  areaId: string;
  momo: string;
  today: string;
}

async function makeWorld(name: string): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, mgr, waiter] = await Promise.all(["owner", "mgr", "wait"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  for (const [u, role] of [[mgr, "MANAGER"], [waiter, "WAITER"]] as const) {
    await db.membership.create({ data: { userId: u.id, businessId: biz.id, role, allBranches: false, branches: { create: { branchId: branch.id, businessId: biz.id } } } });
  }
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", price: 100_000 } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  const { timezone } = await db.business.findUniqueOrThrow({ where: { id: biz.id }, select: { timezone: true } });
  return { owner: { ...base, userId: owner.id, role: "OWNER" }, manager: { ...base, userId: mgr.id, role: "MANAGER" }, waiter: { ...base, userId: waiter.id, role: "WAITER" }, areaId: area.id, momo: momo.id, today: localDate(new Date(), timezone) };
}

async function openOrder(w: World, qty = 1) {
  const table = await db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.owner.branchId, areaId: w.areaId, label: `T${uid()}` } });
  const order = await createOrder(w.owner, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
  await addItem(w.owner, order.id, { menuItemId: w.momo, quantity: qty });
  return order;
}
async function paid(w: World, discountBps = 0, qty = 1) {
  const order = await openOrder(w, qty);
  const discount = discountBps ? ({ kind: "percent", bps: discountBps } as const) : ({ kind: "none" } as const);
  const t = await previewBill(w.owner, order.id, discount);
  return checkout(w.owner, order.id, { discount, payments: [{ method: "CASH", amount: t.grandTotal }] });
}

const settings = (o: Partial<OwnerConfigInput> = {}): OwnerConfigInput => ({
  summaryEnabled: false, summaryHour: 22, channelPush: false, smsPhone: "", email: "", alertsEnabled: true,
  alertVoidCount: 3, alertVoidAmount: 500_000, alertDiscountPct: 20, alertDiscountSharePct: 10, alertRefundAmount: 500_000, alertCashDiff: 10_000, ...o,
});

function unzipNames(zip: Uint8Array): Record<string, string> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.slice(p + 46, p + 46 + nameLen));
    const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out[name] = new TextDecoder().decode(zip.slice(dataAt, dataAt + size));
    p += 46 + nameLen;
  }
  return out;
}

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-owner-a");
  b = await makeWorld("itest-owner-b");
});

afterEach(() => {
  setPushSender(null);
  setProviderForTests(undefined);
  setEmailProviderForTests(undefined);
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.pushSubscription.deleteMany({ where: { businessId: id } });
    await db.ownerAlert.deleteMany({ where: { businessId: id } });
    await db.refundPayment.deleteMany({ where: { businessId: id } });
    await db.creditNote.deleteMany({ where: { businessId: id } });
    await db.dayClose.deleteMany({ where: { businessId: id } });
    await db.orderItemAddOn.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.timeEntry.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("owner settings", () => {
  it("are for the owner only, validated, and keep the phone and email in a clean form", async () => {
    await expect(getOwnerSettings(a.manager)).rejects.toThrow(/Only the owner/);
    await expect(saveOwnerSettings(a.manager, settings())).rejects.toThrow(/Only the owner/);
    await expect(saveOwnerSettings(a.owner, settings({ summaryHour: 24 }))).rejects.toThrow(/0 to 23/);
    await expect(saveOwnerSettings(a.owner, settings({ alertDiscountPct: 120 }))).rejects.toThrow(/Discount percent/);
    await expect(saveOwnerSettings(a.owner, settings({ alertVoidCount: -1 }))).rejects.toThrow(/Cancelled bills/);
    await expect(saveOwnerSettings(a.owner, settings({ email: "not-an-email" }))).rejects.toThrow(/email address/);
    await expect(saveOwnerSettings(a.owner, settings({ smsPhone: "123" }))).rejects.toThrow(/valid phone/);
    await saveOwnerSettings(a.owner, settings({ smsPhone: "9841234567", email: " Owner@Example.com " }));
    const { config } = await getOwnerSettings(a.owner);
    expect(config).toMatchObject({ smsPhone: "+9779841234567", email: "Owner@Example.com", alertVoidCount: 3, alertDiscountShareBps: 1000 });
    await saveOwnerSettings(a.owner, settings()); // back to no phone or email
  });
});

describe("alerts", () => {
  it("are found once, keep their details, are private to the business, and can be marked seen", async () => {
    await saveOwnerSettings(a.owner, settings());
    await paid(a, 3000); // 30% discount on one bill
    const big = await paid(a, 0, 6); // Rs 6,000 bill (to refund)
    await refundInvoice(a.owner, big.id, "wrong order for the whole table");
    for (let i = 0; i < 3; i++) await cancelOrder(a.owner, (await openOrder(a)).id, "guest left");
    await closeDay(a.owner, { date: a.today, countedCash: 1, note: "short on purpose" });

    const first = (await runOwnerChecks()).find((r) => r.businessId === a.owner.businessId)!;
    expect(first.newAlerts).toBeGreaterThanOrEqual(4);
    const kinds = (await listAlerts(a.owner)).map((x) => x.kind).sort();
    expect(kinds).toEqual(expect.arrayContaining(["CASH_DIFFERENCE", "DISCOUNT_BILL", "REFUND", "VOIDS"]));
    const refund = (await listAlerts(a.owner)).find((x) => x.kind === "REFUND")!;
    expect(refund.detail).toMatch(/your limit is/);

    // running again finds nothing new
    expect((await runOwnerChecks()).find((r) => r.businessId === a.owner.businessId)!.newAlerts).toBe(0);
    expect(await db.ownerAlert.count({ where: { businessId: a.owner.businessId } })).toBe(kinds.length);

    // another business sees none of it, and a manager cannot read them
    expect(await listAlerts(b.owner)).toEqual([]);
    await expect(listAlerts(a.manager)).rejects.toThrow(/Only the owner/);
    expect(await unseenAlertCount(a.manager)).toBe(0);

    expect(await unseenAlertCount(a.owner)).toBe(kinds.length);
    await markAlertsSeen(a.owner);
    expect(await unseenAlertCount(a.owner)).toBe(0);
  });

  it("are not raised when the owner switched them off, or for a quiet business", async () => {
    await saveOwnerSettings(b.owner, settings({ alertsEnabled: false }));
    for (let i = 0; i < 4; i++) await cancelOrder(b.owner, (await openOrder(b)).id, "test cancel");
    expect((await runOwnerChecks()).find((r) => r.businessId === b.owner.businessId)?.newAlerts ?? 0).toBe(0);
    expect(await db.ownerAlert.count({ where: { businessId: b.owner.businessId } })).toBe(0);
  });
});

describe("the daily summary", () => {
  it("has the day's numbers, including cancelled bills and what the staff did", async () => {
    const s = await buildSummary(a.owner.businessId, a.today);
    expect(s.data.sales.count).toBeGreaterThanOrEqual(1);
    expect(s.data.cancelled.count).toBe(3);
    expect(s.data.refunds.count).toBe(1);
    expect(s.data.alerts.length).toBeGreaterThanOrEqual(4);
    expect(s.full.join("\n")).toContain("THINGS TO CHECK");
    expect(s.short.length).toBeLessThan(400);
    expect(s.data.staffOff).toEqual(expect.arrayContaining([expect.stringContaining("itest-owner-a")]));
  });

  it("goes out once a day by each channel the owner chose, and never twice", async () => {
    const sms: { to: string; text: string }[] = [];
    const mails: { to: string; subject: string; text: string }[] = [];
    const pushes: string[] = [];
    const smsProvider: Provider = { name: "Fake", async send(to, text) { sms.push({ to, text }); return { ok: true }; } };
    const mailProvider: EmailProvider = { name: "Fake", async send(to, subject, text) { mails.push({ to, subject, text }); return { ok: true }; } };
    setProviderForTests(smsProvider);
    setEmailProviderForTests(mailProvider);
    await db.pushSubscription.create({ data: { userId: a.owner.userId, businessId: a.owner.businessId, endpoint: `https://push.example.test/o-${stamp}`, p256dh: "B".repeat(87), auth: "A".repeat(22) } });
    setPushSender(async (_s, payload) => { pushes.push(JSON.parse(payload).title); });

    await saveOwnerSettings(a.owner, settings({ summaryEnabled: true, summaryHour: 0, channelPush: true, smsPhone: "9841234567", email: "owner@example.com" }));
    const run1 = (await runOwnerChecks()).find((r) => r.businessId === a.owner.businessId)!;
    expect(run1.summarySent).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(sms).toHaveLength(1);
    expect(sms[0]!.to).toBe("+9779841234567");
    expect(sms[0]!.text).toContain("itest-owner-a");
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: "owner@example.com" });
    expect(mails[0]!.text).toContain("SALES");
    expect(pushes.some((t) => t.startsWith("Daily summary"))).toBe(true);

    // later checks the same day send nothing more
    const run2 = (await runOwnerChecks()).find((r) => r.businessId === a.owner.businessId)!;
    expect(run2.summarySent).toBe(false);
    expect(sms).toHaveLength(1);
    expect(mails).toHaveLength(1);
    expect((await getOwnerSettings(a.owner)).config.lastSummaryDate).toBe(a.today);
  });

  it("lets the owner send it now, reports each channel on its own, and never leaks one failure into another", async () => {
    const mails: string[] = [];
    setProviderForTests(null); // no text-message provider
    setEmailProviderForTests({ name: "Fake", async send(to) { mails.push(to); return { ok: false, error: "mailbox full" }; } });
    await saveOwnerSettings(a.owner, settings({ channelPush: false, smsPhone: "9841234567", email: "owner@example.com" }));
    const report = await sendSummaryNow(a.owner);
    expect(report).toEqual({ push: "off", sms: "no text-message provider on this server", email: "mailbox full" });
    expect(mails).toEqual(["owner@example.com"]);
    await expect(sendSummaryNow(a.manager)).rejects.toThrow(/Only the owner/);
    expect(await db.auditEvent.count({ where: { businessId: a.owner.businessId, action: "owner.summarySent" } })).toBe(1);
  });
});

describe("the accountant's workbook", () => {
  it("holds every bill, payment, refund and cancelled bill of the period, in rupees", async () => {
    const book = unzipNames(await buildAccountantWorkbook(a.owner, a.today, a.today));
    const sheets = book["xl/workbook.xml"]!;
    for (const name of ["About", "Daily totals", "Sales", "Payments", "Refunds", "Cancelled bills", "Supplier bills"]) expect(sheets).toContain(`name="${name}"`);
    const sales = book["xl/worksheets/sheet3.xml"]!;
    const inv = await db.invoice.findMany({ where: { businessId: a.owner.businessId }, orderBy: { number: "asc" } });
    expect(inv.length).toBeGreaterThanOrEqual(2);
    for (const i of inv) expect(sales).toContain(`<v>${i.number}</v>`);
    expect(sales).toContain(`<v>${inv[0]!.grandTotal / 100}</v>`); // a total, as rupees
    expect(book["xl/worksheets/sheet5.xml"]).toContain("wrong order for the whole table"); // the refund reason
    expect((book["xl/worksheets/sheet6.xml"]!.match(/guest left/g) ?? []).length).toBe(3);
    expect(book["xl/worksheets/sheet1.xml"]).toContain("not a tax return");
  });

  it("is for the owner only, for sensible dates, and shows only this business", async () => {
    await expect(buildAccountantWorkbook(a.manager, a.today, a.today)).rejects.toThrow(/Only the owner/);
    await expect(buildAccountantWorkbook(a.owner, "nope", a.today)).rejects.toThrow(/valid start and end/);
    await expect(buildAccountantWorkbook(a.owner, a.today, "2000-01-01")).rejects.toThrow(/must not be after/);
    await expect(buildAccountantWorkbook(a.owner, "2020-01-01", "2026-12-31")).rejects.toThrow(/a year or less/);
    const other = unzipNames(await buildAccountantWorkbook(b.owner, a.today, a.today));
    expect(other["xl/worksheets/sheet3.xml"]).not.toContain("<v>1</v></c><c r=\"B2\"" + "x"); // no sales rows of the other business leak in
    expect((other["xl/worksheets/sheet3.xml"]!.match(/<row /g) ?? []).length).toBe(1 + (await db.invoice.count({ where: { businessId: b.owner.businessId } })));
    expect(await db.auditEvent.count({ where: { businessId: a.owner.businessId, action: "owner.export" } })).toBeGreaterThanOrEqual(1);
  });
});
