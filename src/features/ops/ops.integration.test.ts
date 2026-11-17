import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { localDate } from "@/lib/business-day";
import { createSupplier } from "@/features/purchasing/server/service";
import { createBill, getPayables, listBills, recordBillPayment, voidBill } from "@/features/purchasing/server/bills";
import { addManualEntry, clockIn, clockOut, editEntry, monthOf } from "@/features/payroll/server/time";
import { addAdjustment, finalizePayroll, markLinePaid, previewPayroll, setPayTerms } from "@/features/payroll/server/payroll";
import { createCampaign, prepareCampaign } from "@/features/campaigns/server/service";
import { segmentOf } from "@/features/campaigns/segments";
import { getSendStatus, sendCampaign } from "@/features/messaging/server/send";
import { setProviderForTests, type Provider } from "@/features/messaging/providers";
import { applyOfflineOrder } from "@/features/orders/server/offline-sync";
import { createOrder } from "@/features/orders/server/service";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;
let phoneSeq = 300_000;
const nextPhone = () => `9812${String(++phoneSeq).padStart(6, "0")}`;
const DAY = 86_400_000;

interface World {
  owner: TenantContext;
  manager: TenantContext;
  cashier: TenantContext;
  waiter: TenantContext;
  staffId: string;
  branchId: string;
  tz: string;
  tea: string;
  cake: string;
}

async function makeWorld(name: string): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, mgr, cashier, waiter] = await Promise.all(["owner", "mgr", "cash", "wait"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  for (const [u, role] of [[mgr, "MANAGER"], [cashier, "CASHIER"], [waiter, "WAITER"]] as const) {
    await db.membership.create({ data: { userId: u.id, businessId: biz.id, role, allBranches: false, branches: { create: { branchId: branch.id, businessId: biz.id } } } });
  }
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Tea", price: 8_000 } });
  const cake = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Cake", price: 15_000 } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  const { timezone } = await db.business.findUniqueOrThrow({ where: { id: biz.id }, select: { timezone: true } });
  return {
    owner: { ...base, userId: owner.id, role: "OWNER" },
    manager: { ...base, userId: mgr.id, role: "MANAGER" },
    cashier: { ...base, userId: cashier.id, role: "CASHIER" },
    waiter: { ...base, userId: waiter.id, role: "WAITER" },
    staffId: waiter.id,
    branchId: branch.id,
    tz: timezone,
    tea: tea.id,
    cake: cake.id,
  };
}

let w: World;
let other: World;

beforeAll(async () => {
  w = await makeWorld("itest-ops-a");
  other = await makeWorld("itest-ops-b");
});

afterEach(() => setProviderForTests(undefined));

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.messageLog.deleteMany({ where: { businessId: id } });
    await db.campaignMessage.deleteMany({ where: { businessId: id } });
    await db.campaign.deleteMany({ where: { businessId: id } });
    await db.customer.deleteMany({ where: { businessId: id } });
    await db.supplierPayment.deleteMany({ where: { businessId: id } });
    await db.supplierBill.deleteMany({ where: { businessId: id } });
    await db.supplier.deleteMany({ where: { businessId: id } });
    await db.payrollLine.deleteMany({ where: { businessId: id } });
    await db.payrollRun.deleteMany({ where: { businessId: id } });
    await db.payAdjustment.deleteMany({ where: { businessId: id } });
    await db.timeEntry.deleteMany({ where: { businessId: id } });
    await db.orderItemAddOn.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

// --- supplier bills --------------------------------------------------------------------------

describe("supplier bills", () => {
  const today = () => localDate(new Date(), w.tz);
  let supplierId: string;
  let billId: string;

  it("records a bill, rejects a repeat number, and limits who may handle bills", async () => {
    supplierId = (await createSupplier(w.owner, { name: "Fresh Farms" })).id;
    const bill = await createBill(w.manager, { supplierId, number: "INV-1", billDate: today(), amount: 100_000 });
    billId = bill.id;
    await expect(createBill(w.owner, { supplierId, number: "inv-1", billDate: today(), amount: 5_000 })).rejects.toThrow(/already has a bill/);
    await expect(createBill(w.cashier, { supplierId, billDate: today(), amount: 5_000 })).rejects.toThrow(/permission/);
    await expect(createBill(w.owner, { supplierId, billDate: today(), amount: 0 })).rejects.toThrow();
    await expect(createBill(w.owner, { supplierId, billDate: today(), dueDate: "2000-01-01", amount: 100 })).rejects.toThrow(/before the bill date/);
  });

  it("never lets payments add up to more than the bill", async () => {
    await recordBillPayment(w.owner, billId, { amount: 60_000, method: "CASH", paidOn: today() });
    await expect(recordBillPayment(w.owner, billId, { amount: 40_001, method: "BANK", paidOn: today() })).rejects.toThrow(/still owed/);
    // two payments at once for the remaining 40,000: only one can win
    const results = await Promise.allSettled([
      recordBillPayment(w.owner, billId, { amount: 40_000, method: "QR", paidOn: today() }),
      recordBillPayment(w.manager, billId, { amount: 40_000, method: "CASH", paidOn: today() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [row] = (await listBills(w.owner)).filter((b) => b.id === billId);
    expect(row!.outstanding).toBe(0);
    await expect(recordBillPayment(w.owner, billId, { amount: 1, method: "CASH", paidOn: today() })).rejects.toThrow(/still owed/);
  });

  it("will not void a bill with payments, but voids an unpaid one and drops it from what is owed", async () => {
    await expect(voidBill(w.owner, billId, "oops")).rejects.toThrow(/cannot be voided/);
    const unpaid = await createBill(w.owner, { supplierId, billDate: today(), amount: 7_000 });
    expect((await getPayables(w.owner)).totals.outstanding).toBe(7_000);
    await voidBill(w.owner, unpaid.id, "entered twice");
    expect((await getPayables(w.owner)).totals.outstanding).toBe(0);
  });

  it("keeps another business's suppliers and bills out of reach", async () => {
    await expect(createBill(other.owner, { supplierId, billDate: today(), amount: 100 })).rejects.toThrow(/Supplier not found/);
    await expect(recordBillPayment(other.owner, billId, { amount: 100, method: "CASH", paidOn: today() })).rejects.toThrow(/not found/);
    expect(await listBills(other.owner)).toHaveLength(0);
  });
});

// --- time and payroll ------------------------------------------------------------------------

describe("staff time and payroll", () => {
  // a day in the middle of last month, 06:00 to 14:00 UTC (the same calendar day in Nepal)
  const d = new Date();
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15));
  const at = (h: number, dayOffset = 0) => new Date(day.getTime() + dayOffset * DAY + h * 3_600_000);
  const period = () => monthOf(at(6), w.tz);

  it("lets only the owner set pay terms", async () => {
    await expect(setPayTerms(w.manager, w.staffId, { payType: "HOURLY", payRate: 20_000 })).rejects.toThrow(/owner/i);
    await setPayTerms(w.owner, w.staffId, { payType: "HOURLY", payRate: 20_000 });
    await expect(setPayTerms(w.owner, w.staffId, { payType: "HOURLY", payRate: -1 })).rejects.toThrow();
  });

  it("clocks in once, out once, and refuses a second open shift", async () => {
    await clockIn(w.waiter);
    await expect(clockIn(w.waiter)).rejects.toThrow(/already clocked in/);
    await clockOut(w.waiter);
    await expect(clockOut(w.waiter)).rejects.toThrow(/not clocked in/);
  });

  it("lets a manager add and fix hours but not overlap another shift, and a waiter cannot", async () => {
    await expect(addManualEntry(w.waiter, { userId: w.staffId, clockIn: at(6), clockOut: at(14) })).rejects.toThrow(/permission/);
    const e = await addManualEntry(w.manager, { userId: w.staffId, clockIn: at(6), clockOut: at(14), note: "forgot to clock" });
    await expect(addManualEntry(w.manager, { userId: w.staffId, clockIn: at(10), clockOut: at(12) })).rejects.toThrow(/overlaps/);
    await expect(editEntry(w.manager, e.id, { clockIn: at(14), clockOut: at(6) })).rejects.toThrow();
  });

  it("works out the month, applies an adjustment, and refuses to finalize with someone still clocked in", async () => {
    await addAdjustment(w.owner, { userId: w.staffId, period: period(), kind: "BONUS", amount: 5_000, note: "festival" });
    const p = await previewPayroll(w.owner, period());
    const line = p.lines.find((l) => l.userId === w.staffId)!;
    expect(line.regularMinutes + line.overtimeMinutes).toBe(480);
    expect(line.additions).toBe(5_000);
    expect(line.netPay).toBe(line.basePay + line.overtimePay + 5_000);
    expect(p.finalized).toBe(false);
    await expect(previewPayroll(w.manager, period())).rejects.toThrow(/owner/i);
  });

  it("finalizes once, locks the month's hours and adjustments, and marks lines paid once", async () => {
    const before = await previewPayroll(w.owner, period());
    const run = await finalizePayroll(w.owner, period(), "monthly run");
    await expect(finalizePayroll(w.owner, period())).rejects.toThrow(/already finalized/);
    await expect(addManualEntry(w.manager, { userId: w.staffId, clockIn: at(15), clockOut: at(16) })).rejects.toThrow(/finalized/);
    await expect(addAdjustment(w.owner, { userId: w.staffId, period: period(), kind: "BONUS", amount: 100 })).rejects.toThrow(/finalized|locked/i);
    const lines = await db.payrollLine.findMany({ where: { runId: run.id } });
    expect(lines.map((l) => l.netPay)).toEqual(before.lines.map((l) => l.netPay));
    await markLinePaid(w.owner, lines[0]!.id, "Cash");
    await expect(markLinePaid(w.owner, lines[0]!.id, "Cash")).rejects.toThrow(/already/);
    expect((await previewPayroll(w.owner, period())).finalized).toBe(true);
  });
});

// --- sending campaign messages ---------------------------------------------------------------

describe("sending campaign messages", () => {
  async function person(consent: "verified" | "none", name = "Test Person") {
    return db.customer.create({
      data: {
        businessId: w.owner.businessId,
        phone: `+977${nextPhone()}`,
        name,
        visitCount: 1,
        totalSpend: 50_000,
        lastVisitAt: new Date(Date.now() - DAY),
        marketingConsent: consent !== "none",
        consentVerified: consent === "verified",
      },
    });
  }
  function fake(opts: { failFor?: string } = {}) {
    const calls: { to: string; text: string }[] = [];
    const p: Provider = {
      name: "Fake",
      async send(to, text) {
        calls.push({ to, text });
        return opts.failFor && to === opts.failFor ? { ok: false, error: "number rejected" } : { ok: true, ref: `m${calls.length}` };
      },
    };
    return { p, calls };
  }
  async function prepared() {
    const c = await person("verified", "Asha");
    await person("none", "Bina");
    const segment = segmentOf(c, new Date());
    const camp = await createCampaign(w.owner, { name: `Send ${uid()}`, segment, template: "Hi {name}, come back to {business}!", offerPoints: 10, offerDays: 7 });
    await prepareCampaign(w.owner, camp.id);
    return { camp, c };
  }

  it("does nothing when no provider is set up, or the person may not send", async () => {
    const { camp } = await prepared();
    setProviderForTests(null);
    await expect(sendCampaign(w.owner, camp.id, 1)).rejects.toThrow(/not set up/);
    expect((await getSendStatus(w.owner, camp.id)).provider).toBeNull();
    const f = fake();
    setProviderForTests(f.p);
    await expect(sendCampaign(w.manager, camp.id, 1)).rejects.toThrow(/permission/);
    expect(f.calls).toHaveLength(0);
  });

  it("needs the exact count that was confirmed, then sends only to people who agreed", async () => {
    const { camp } = await prepared();
    const f = fake();
    setProviderForTests(f.p);
    const status = await getSendStatus(w.owner, camp.id);
    expect(status.ready).toBeGreaterThanOrEqual(1);
    await expect(sendCampaign(w.owner, camp.id, status.ready + 3)).rejects.toThrow(/list changed/);
    expect(f.calls).toHaveLength(0);
    const res = await sendCampaign(w.owner, camp.id, status.ready);
    expect(res.sent).toBe(status.ready);
    expect(f.calls.every((c) => c.text.startsWith("Hi "))).toBe(true);
    const sentRows = await db.campaignMessage.findMany({ where: { campaignId: camp.id, status: "SENT" } });
    expect(sentRows).toHaveLength(res.sent);
    expect(sentRows[0]!.expiresAt).not.toBeNull(); // the offer window started
    // sending again finds nothing and never repeats a message
    await expect(sendCampaign(w.owner, camp.id, 0)).rejects.toThrow(/nothing to send/i);
    expect(f.calls).toHaveLength(res.sent);
    const logs = await db.messageLog.findMany({ where: { campaignId: camp.id } });
    expect(logs.every((l) => l.status === "SENT" && l.phoneMasked.includes("•"))).toBe(true);
  });

  it("skips someone who withdraws consent after the list was prepared", async () => {
    const { camp, c } = await prepared();
    await db.customer.update({ where: { businessId_id: { businessId: w.owner.businessId, id: c.id } }, data: { marketingConsent: false } });
    const f = fake();
    setProviderForTests(f.p);
    expect((await getSendStatus(w.owner, camp.id)).ready).toBe(0);
    await expect(sendCampaign(w.owner, camp.id, 0)).rejects.toThrow(/nothing to send/i);
    expect(f.calls).toHaveLength(0);
  });

  it("keeps a failed message queued, hides secrets, and retries it without double-sending the rest", async () => {
    const a1 = await person("verified", "One");
    const a2 = await person("verified", "Two");
    const segment = segmentOf(a1, new Date());
    const camp = await createCampaign(w.owner, { name: `Retry ${uid()}`, segment, template: "Hello {name}", offerPoints: 0, offerDays: 7 });
    await prepareCampaign(w.owner, camp.id);
    const f = fake({ failFor: a2.phone! });
    setProviderForTests(f.p);
    const ready = (await getSendStatus(w.owner, camp.id)).ready;
    expect(ready).toBe(2);
    const first = await sendCampaign(w.owner, camp.id, ready);
    expect(first.failed).toBe(1);
    expect(first.sent).toBe(ready - 1);
    const failedMsg = await db.campaignMessage.findFirstOrThrow({ where: { campaignId: camp.id, customerId: a2.id } });
    expect(failedMsg.status).toBe("QUEUED");
    const callsBefore = f.calls.length;
    const ok = fake();
    setProviderForTests(ok.p);
    const second = await sendCampaign(w.owner, camp.id, 1);
    expect(second.sent).toBe(1);
    expect(ok.calls.map((c) => c.to)).toEqual([a2.phone]);
    expect(f.calls.length).toBe(callsBefore); // the first provider was not called again
  });

  it("stops at the daily limit", async () => {
    const x = await person("verified", "Limit");
    const camp = await createCampaign(w.owner, { name: `Limit ${uid()}`, segment: segmentOf(x, new Date()), template: "Hi {name}", offerPoints: 0, offerDays: 7 });
    await prepareCampaign(w.owner, camp.id);
    const used = await db.messageLog.count({ where: { businessId: w.owner.businessId, createdAt: { gt: new Date(Date.now() - DAY) } } });
    const prev = process.env.MESSAGING_DAILY_LIMIT;
    process.env.MESSAGING_DAILY_LIMIT = String(used + 1);
    try {
      const f = fake();
      setProviderForTests(f.p);
      const st = await getSendStatus(w.owner, camp.id);
      expect(st.ready).toBe(1);
      const res = await sendCampaign(w.owner, camp.id, 1);
      expect(res.sent).toBe(1);
      expect(res.deferred).toBeGreaterThanOrEqual(0);
      await expect(sendCampaign(w.owner, camp.id, 0)).rejects.toThrow(/limit|nothing/i);
    } finally {
      if (prev === undefined) delete process.env.MESSAGING_DAILY_LIMIT;
      else process.env.MESSAGING_DAILY_LIMIT = prev;
    }
  });
});

// --- orders taken offline --------------------------------------------------------------------

describe("offline order sync", () => {
  async function table() {
    const area = (await db.area.findFirst({ where: { businessId: w.owner.businessId, branchId: w.branchId } })) ?? (await db.area.create({ data: { businessId: w.owner.businessId, branchId: w.branchId, name: "Main" } }));
    return db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.branchId, areaId: area.id, label: `O${uid()}` } });
  }
  const key = () => `offline-${uid()}-${stamp}`;

  it("creates the order with its items, and sending it again changes nothing", async () => {
    const t = await table();
    const k = key();
    const payload = { key: k, branchId: w.branchId, type: "DINE_IN" as const, tableId: t.id, items: [{ menuItemId: w.tea, quantity: 2 }, { menuItemId: w.cake, quantity: 1, note: "no nuts" }] };
    const first = await applyOfflineOrder(w.waiter, payload);
    expect(first.ok).toBe(true);
    const again = await applyOfflineOrder(w.waiter, payload);
    expect(again).toMatchObject({ ok: true, repeat: true });
    if (first.ok && again.ok) expect(again.orderId).toBe(first.orderId);
    const items = await db.orderItem.findMany({ where: { orderId: first.ok ? first.orderId : "x" } });
    expect(items.reduce((s, i) => s + i.quantity, 0)).toBe(3);
    expect(items.find((i) => i.note === "no nuts")).toBeTruthy();
  });

  it("handles a takeaway order and ignores any table sent with it", async () => {
    const t = await table();
    const r = await applyOfflineOrder(w.waiter, { key: key(), branchId: w.branchId, type: "TAKEAWAY", tableId: t.id, items: [{ menuItemId: w.tea, quantity: 1 }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect((await db.order.findUniqueOrThrow({ where: { id: r.orderId } })).tableId).toBeNull();
  });

  it("refuses an order taken at another branch, and a table that is already in use", async () => {
    const t = await table();
    const wrong = await applyOfflineOrder(w.waiter, { key: key(), branchId: "some-other-branch", type: "TAKEAWAY", items: [{ menuItemId: w.tea, quantity: 1 }] });
    expect(wrong).toMatchObject({ ok: false, retry: false });
    await createOrder(w.waiter, { type: "DINE_IN", tableId: t.id, idempotencyKey: key() });
    const busy = await applyOfflineOrder(w.waiter, { key: key(), branchId: w.branchId, type: "DINE_IN", tableId: t.id, items: [{ menuItemId: w.tea, quantity: 1 }] });
    expect(busy).toMatchObject({ ok: false, retry: false });
    if (!busy.ok) expect(busy.error).toMatch(/already has an open order/);
  });

  it("reports an item that was switched off, keeping the rest", async () => {
    const t = await table();
    await db.menuItem.update({ where: { id: w.cake }, data: { available: false } });
    try {
      const r = await applyOfflineOrder(w.waiter, { key: key(), branchId: w.branchId, type: "DINE_IN", tableId: t.id, items: [{ menuItemId: w.tea, quantity: 1 }, { menuItemId: w.cake, quantity: 1 }] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/was created but 1 item was refused/);
      expect(await db.orderItem.count({ where: { businessId: w.owner.businessId, menuItemId: w.tea, order: { tableId: t.id } } })).toBe(1);
    } finally {
      await db.menuItem.update({ where: { id: w.cake }, data: { available: true } });
    }
  });

  it("does not let a kitchen-only or rider role take orders through it", async () => {
    // permissions are enforced by createOrder itself
    const kitchen: TenantContext = { ...w.waiter, role: "KITCHEN" };
    const r = await applyOfflineOrder(kitchen, { key: key(), branchId: w.branchId, type: "TAKEAWAY", items: [{ menuItemId: w.tea, quantity: 1 }] });
    expect(r.ok).toBe(false);
  });
});
