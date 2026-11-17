import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createAddOn, createGroup, setGroupItems } from "@/features/menu/server/addons";
import { closeDay } from "@/features/reports/server/service";
import { localDate } from "@/lib/business-day";
import { priceOfflineBill, type OfflineBillInput, type OfflineSnapshot } from "../billing";
import { makeSnapshot, verifySnapshot, type SignedSnapshot } from "./snapshot";
import { BLOCK_SIZE, closeBlock, listBlocks, listGaps, prepareDeviceBlocks } from "./blocks";
import { syncOfflineBill } from "./sync";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;
const device = () => `dev-${uid()}-${"x".repeat(20)}`;

interface World {
  owner: TenantContext;
  cashier: TenantContext;
  waiter: TenantContext;
  momo: string;
  tea: string;
  fancy: string; // has a required add-on choice
  tableId: string;
  businessId: string;
  tz: string;
}

async function makeWorld(name: string): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, cashier, waiter] = await Promise.all(["owner", "cash", "wait"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  for (const [u, role] of [[cashier, "CASHIER"], [waiter, "WAITER"]] as const) {
    await db.membership.create({ data: { userId: u.id, businessId: biz.id, role, allBranches: false, branches: { create: { branchId: branch.id, businessId: biz.id } } } });
  }
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const table = await db.diningTable.create({ data: { businessId: biz.id, branchId: branch.id, areaId: area.id, label: "T1" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Buff Momo", price: 25_000 } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Tea", price: 8_000 } });
  const fancy = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Thali", price: 40_000 } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  const ownerCtx: TenantContext = { ...base, userId: owner.id, role: "OWNER" };
  const g = await createGroup(ownerCtx, { name: "Size", required: true, multiple: false });
  await createAddOn(ownerCtx, g.id, { name: "Large", price: 5_000 });
  await setGroupItems(ownerCtx, g.id, [fancy.id]);
  const { timezone } = await db.business.findUniqueOrThrow({ where: { id: biz.id }, select: { timezone: true } });
  return { owner: ownerCtx, cashier: { ...base, userId: cashier.id, role: "CASHIER" }, waiter: { ...base, userId: waiter.id, role: "WAITER" }, momo: momo.id, tea: tea.id, fancy: fancy.id, tableId: table.id, businessId: biz.id, tz: timezone };
}

/** A bill as the phone would make it: priced from the snapshot, paid in cash. */
function billFor(signed: SignedSnapshot, o: Partial<OfflineBillInput> & { deviceId: string; invoiceNumber: number }, now = new Date()): OfflineBillInput {
  const snap = JSON.parse(signed.snapshot) as OfflineSnapshot;
  const items = o.items ?? [{ menuItemId: snap.items[0]!.id, quantity: 2 }, { menuItemId: snap.items[1]!.id, quantity: 1, note: "no sugar" }];
  const discount = o.discount ?? { kind: "none" as const };
  const total = priceOfflineBill(snap, items, discount).totals.grandTotal;
  return {
    key: `bill-${uid()}-${stamp}`,
    type: "TAKEAWAY",
    tableId: null,
    billedAt: new Date(now.getTime() - 60_000).toISOString(),
    items,
    discount,
    payments: [{ method: "CASH", amount: total }],
    expectedTotal: total,
    ...o,
  };
}

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-offline-a");
  b = await makeWorld("itest-offline-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.dayClose.deleteMany({ where: { businessId: id } });
    await db.invoiceGap.deleteMany({ where: { businessId: id } });
    await db.offlineNumberBlock.deleteMany({ where: { businessId: id } });
    await db.loyaltyEntry.deleteMany({ where: { businessId: id } });
    await db.stockMovement.deleteMany({ where: { businessId: id } });
    await db.orderItemAddOn.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.customer.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("the signed snapshot", () => {
  it("holds the plain dishes at this branch's prices and the tables, and checks out", async () => {
    const signed = await makeSnapshot(a.cashier);
    const snap = verifySnapshot(signed.snapshot, signed.sig, a.cashier);
    expect(snap.items.map((i) => i.name).sort()).toEqual(["Buff Momo", "Tea"]); // the dish with a required choice stays online
    expect(snap.items.find((i) => i.name === "Tea")?.price).toBe(8_000);
    expect(snap.tables.map((t) => t.id)).toEqual([a.tableId]);
    expect(snap.business).toMatchObject({ serviceChargeBps: 1000, vatBps: 1300 });
    await expect(makeSnapshot({ ...a.waiter, role: "KITCHEN" })).rejects.toThrow(/permission/);
  });

  it("is refused if a price is changed, if it is for another business, or if it is garbage", async () => {
    const signed = await makeSnapshot(a.cashier);
    const forged = signed.snapshot.replace('"price":8000', '"price":1');
    expect(forged).not.toBe(signed.snapshot);
    expect(() => verifySnapshot(forged, signed.sig, a.cashier)).toThrow(/changed or is not valid/);
    expect(() => verifySnapshot(signed.snapshot, signed.sig, b.cashier)).toThrow(/another business/);
    expect(() => verifySnapshot(signed.snapshot, "x".repeat(20), a.cashier)).toThrow(/not valid/);
    expect(() => verifySnapshot("{}", signed.sig, a.cashier)).toThrow(/not valid/);
    expect(() => verifySnapshot(signed.snapshot, signed.sig, a.cashier, new Date(Date.now() + 100 * 86_400_000))).toThrow(/far too old/);
  });
});

describe("invoice number blocks", () => {
  it("give each phone its own run of numbers from the one counter, and never overlap", async () => {
    const before = (await db.business.findUniqueOrThrow({ where: { id: a.businessId } })).invoiceCounter;
    const d1 = device();
    const d2 = device();
    const one = await prepareDeviceBlocks(a.cashier, d1);
    const two = await prepareDeviceBlocks(a.owner, d2);
    expect(one.blocks).toHaveLength(1);
    expect(one.blocks[0]!.to - one.blocks[0]!.from + 1).toBe(BLOCK_SIZE);
    expect(one.blocks[0]!.from).toBe(before + 1);
    expect(two.blocks[0]!.from).toBe(one.blocks[0]!.to + 1);
    // asking again while plenty is left changes nothing
    const again = await prepareDeviceBlocks(a.cashier, d1);
    expect(again.blocks.map((x) => x.id)).toEqual(one.blocks.map((x) => x.id));
    expect((await db.business.findUniqueOrThrow({ where: { id: a.businessId } })).invoiceCounter).toBe(before + 2 * BLOCK_SIZE);
  });

  it("are only for people who may take payments, for real phone ids, and for the right business", async () => {
    await expect(prepareDeviceBlocks(a.waiter, device())).rejects.toThrow(/permission/);
    await expect(prepareDeviceBlocks(a.cashier, "short")).rejects.toThrow(/could not be identified/);
    await expect(prepareDeviceBlocks(a.cashier, "has spaces and !!! ".repeat(3))).rejects.toThrow(/could not be identified/);
    expect((await listBlocks(b.owner)).length).toBe(0);
  });

  it("do not clash with a bill made online afterwards", async () => {
    const d = device();
    const { blocks } = await prepareDeviceBlocks(a.cashier, d);
    const counter = (await db.business.findUniqueOrThrow({ where: { id: a.businessId } })).invoiceCounter;
    expect(counter).toBeGreaterThanOrEqual(blocks[0]!.to); // online numbers continue after every reserved block
  });
});

describe("a bill arriving from a phone", () => {
  it("is recorded with the reserved number, the server's own total, the real sale time and the right payments", async () => {
    const signed = await makeSnapshot(a.cashier);
    const d = device();
    const { blocks } = await prepareDeviceBlocks(a.cashier, d);
    const number = blocks[0]!.from;
    const bill = billFor(signed, { deviceId: d, invoiceNumber: number, type: "DINE_IN", tableId: a.tableId, discount: { kind: "percent", bps: 1000 } });
    const res = await syncOfflineBill(a.cashier, { ...signed, bill });
    expect(res).toMatchObject({ ok: true, invoiceNumber: number, repeat: false });
    const inv = await db.invoice.findFirstOrThrow({ where: { businessId: a.businessId, number }, include: { payments: true, order: { include: { items: true } } } });
    expect(inv.grandTotal).toBe(bill.expectedTotal);
    expect(inv.discount).toBeGreaterThan(0);
    expect(inv.createdAt.toISOString()).toBe(bill.billedAt);
    expect(inv).toMatchObject({ offlineKey: bill.key, offlineDeviceId: d });
    expect(inv.syncedAt).not.toBeNull();
    expect(inv.payments.map((p) => [p.method, p.amount])).toEqual([["CASH", bill.expectedTotal]]);
    expect(inv.order).toMatchObject({ status: "PAID", type: "DINE_IN", tableId: a.tableId });
    expect(inv.order.items.map((i) => [i.name, i.quantity, i.unitPrice, i.note]).sort()).toEqual([["Buff Momo", 2, 25_000, null], ["Tea", 1, 8_000, "no sugar"]].sort());
    expect((await db.diningTable.findUniqueOrThrow({ where: { id: a.tableId } })).state).toBe("FREE"); // the table is not left seated
    expect(await db.auditEvent.count({ where: { businessId: a.businessId, action: "bill.offline", entityId: inv.id } })).toBe(1);
  });

  it("sending it twice changes nothing", async () => {
    const signed = await makeSnapshot(a.cashier);
    const d = device();
    const { blocks } = await prepareDeviceBlocks(a.cashier, d);
    const bill = billFor(signed, { deviceId: d, invoiceNumber: blocks[0]!.from });
    const first = await syncOfflineBill(a.cashier, { ...signed, bill });
    const orders = await db.order.count({ where: { businessId: a.businessId } });
    const counter = (await db.business.findUniqueOrThrow({ where: { id: a.businessId } })).orderCounter;
    const second = await syncOfflineBill(a.cashier, { ...signed, bill });
    expect(first).toMatchObject({ ok: true, repeat: false });
    expect(second).toMatchObject({ ok: true, repeat: true });
    if (first.ok && second.ok) expect([second.invoiceNumber, second.orderNumber]).toEqual([first.invoiceNumber, first.orderNumber]);
    expect(await db.order.count({ where: { businessId: a.businessId } })).toBe(orders);
    expect((await db.business.findUniqueOrThrow({ where: { id: a.businessId } })).orderCounter).toBe(counter);
    expect(await db.invoice.count({ where: { businessId: a.businessId, offlineKey: bill.key } })).toBe(1);
  });

  it("is refused, and nothing is recorded, when the total does not match the server's own", async () => {
    const signed = await makeSnapshot(a.cashier);
    const d = device();
    const { blocks } = await prepareDeviceBlocks(a.cashier, d);
    const good = billFor(signed, { deviceId: d, invoiceNumber: blocks[0]!.from });
    const bad = { ...good, expectedTotal: good.expectedTotal - 100, payments: [{ method: "CASH" as const, amount: good.expectedTotal - 100 }] };
    const before = await db.invoice.count({ where: { businessId: a.businessId } });
    const counter = (await db.business.findUniqueOrThrow({ where: { id: a.businessId } })).orderCounter;
    expect(await syncOfflineBill(a.cashier, { ...signed, bill: bad })).toMatchObject({ ok: false, code: "INVALID" }); // payments no longer add up to the real total
    const bad2 = { ...good, expectedTotal: good.expectedTotal - 100 };
    expect(await syncOfflineBill(a.cashier, { ...signed, bill: bad2 })).toMatchObject({ ok: false, code: "TOTAL_MISMATCH" });
    expect(await db.invoice.count({ where: { businessId: a.businessId } })).toBe(before);
    expect((await db.business.findUniqueOrThrow({ where: { id: a.businessId } })).orderCounter).toBe(counter);
  });

  it("cannot use a changed price, a dish the phone was not given, or payments that do not add up", async () => {
    const signed = await makeSnapshot(a.cashier);
    const d = device();
    const { blocks } = await prepareDeviceBlocks(a.cashier, d);
    const bill = billFor(signed, { deviceId: d, invoiceNumber: blocks[0]!.from });
    const forged = { snapshot: signed.snapshot.replace('"price":8000', '"price":1'), sig: signed.sig, bill };
    expect(await syncOfflineBill(a.cashier, forged)).toMatchObject({ ok: false, code: "INVALID" });
    const thali = { ...bill, key: `k-${uid()}-${stamp}`, items: [{ menuItemId: a.fancy, quantity: 1 }] };
    expect(await syncOfflineBill(a.cashier, { ...signed, bill: thali })).toMatchObject({ ok: false, code: "INVALID", error: expect.stringMatching(/not on the menu/) });
    const short = { ...bill, key: `k-${uid()}-${stamp}`, payments: [{ method: "CASH" as const, amount: bill.expectedTotal - 1 }] };
    expect(await syncOfflineBill(a.cashier, { ...signed, bill: short })).toMatchObject({ ok: false, code: "INVALID", error: expect.stringMatching(/exactly/) });
    expect(await db.invoice.count({ where: { businessId: a.businessId, number: blocks[0]!.from } })).toBe(0);
  });

  it("must use a number set aside for that phone, and not one already on a bill", async () => {
    const signed = await makeSnapshot(a.cashier);
    const d = device();
    const other = device();
    const mine = await prepareDeviceBlocks(a.cashier, d);
    const theirs = await prepareDeviceBlocks(a.owner, other);
    const stolen = billFor(signed, { deviceId: d, invoiceNumber: theirs.blocks[0]!.from });
    expect(await syncOfflineBill(a.cashier, { ...signed, bill: stolen })).toMatchObject({ ok: false, code: "NUMBER_NOT_RESERVED" });
    const outside = billFor(signed, { deviceId: d, invoiceNumber: 999_999 });
    expect(await syncOfflineBill(a.cashier, { ...signed, bill: outside })).toMatchObject({ ok: false, code: "NUMBER_NOT_RESERVED" });
    // an invoice already carries the number
    const n1 = mine.blocks[0]!.from + 1;
    const first = billFor(signed, { deviceId: d, invoiceNumber: n1 });
    expect(await syncOfflineBill(a.cashier, { ...signed, bill: first })).toMatchObject({ ok: true });
    const dup = billFor(signed, { deviceId: d, invoiceNumber: n1 });
    expect(await syncOfflineBill(a.cashier, { ...signed, bill: dup })).toMatchObject({ ok: false, code: "NUMBER_TAKEN" });
    expect(await db.invoice.count({ where: { businessId: a.businessId, number: n1 } })).toBe(1);
  });

  it("is refused for another business's phone, for a waiter, and for impossible times", async () => {
    const signed = await makeSnapshot(a.cashier);
    const d = device();
    const { blocks } = await prepareDeviceBlocks(a.cashier, d);
    const bill = billFor(signed, { deviceId: d, invoiceNumber: blocks[0]!.from });
    expect(await syncOfflineBill(b.cashier, { ...signed, bill })).toMatchObject({ ok: false, code: "INVALID", error: expect.stringMatching(/another business/) });
    await expect(syncOfflineBill(a.waiter, { ...signed, bill })).rejects.toThrow(/permission/);
    const future = { ...bill, key: `k-${uid()}-${stamp}`, billedAt: new Date(Date.now() + 3_600_000).toISOString() };
    expect(await syncOfflineBill(a.cashier, { ...signed, bill: future })).toMatchObject({ ok: false, error: expect.stringMatching(/future/) });
    const ancient = { ...bill, key: `k-${uid()}-${stamp}`, billedAt: new Date(Date.now() - 10 * 86_400_000).toISOString() };
    expect(await syncOfflineBill(a.cashier, { ...signed, bill: ancient })).toMatchObject({ ok: false, error: expect.stringMatching(/before the menu/) });
    const stale = billFor(signed, { deviceId: d, invoiceNumber: blocks[0]!.from + 2, billedAt: new Date(Date.parse(JSON.parse(signed.snapshot).issuedAt) + 40 * 86_400_000).toISOString() });
    expect(await syncOfflineBill(a.cashier, { ...signed, bill: stale }, new Date(Date.now() + 41 * 86_400_000))).toMatchObject({ ok: false, error: expect.stringMatching(/more than 30 days/) });
  });

  it("gives loyalty points to a customer named by phone, and splits payment across methods", async () => {
    const signed = await makeSnapshot(a.cashier);
    const d = device();
    const { blocks } = await prepareDeviceBlocks(a.cashier, d);
    const base = billFor(signed, { deviceId: d, invoiceNumber: blocks[0]!.from + 3, customerPhone: "9841000111" });
    const bill: OfflineBillInput = { ...base, payments: [{ method: "CASH", amount: base.expectedTotal - 10_000 }, { method: "QR", amount: 10_000 }] };
    expect(await syncOfflineBill(a.cashier, { ...signed, bill })).toMatchObject({ ok: true });
    const customer = await db.customer.findFirstOrThrow({ where: { businessId: a.businessId, phone: "+9779841000111" } });
    const inv = await db.invoice.findFirstOrThrow({ where: { businessId: a.businessId, number: bill.invoiceNumber }, include: { payments: true } });
    expect(inv.customerId).toBe(customer.id);
    expect(inv.pointsEarned).toBeGreaterThan(0);
    expect(customer).toMatchObject({ pointsBalance: inv.pointsEarned, visitCount: 1, totalSpend: inv.grandTotal });
    expect(inv.payments.map((p) => p.method).sort()).toEqual(["CASH", "QR"]);
    const bad: OfflineBillInput = { ...billFor(signed, { deviceId: d, invoiceNumber: blocks[0]!.from + 4 }), customerPhone: "123" };
    expect(await syncOfflineBill(a.cashier, { ...signed, bill: bad })).toMatchObject({ ok: false, error: expect.stringMatching(/phone number is not valid/) });
  });
});

describe("closed days and unused numbers", () => {
  it("will not change a closed day, and goes through once the owner reopens it", async () => {
    const w = await makeWorld("itest-offline-day");
    const signed = await makeSnapshot(w.cashier);
    const d = device();
    const { blocks } = await prepareDeviceBlocks(w.cashier, d);
    const bill = billFor(signed, { deviceId: d, invoiceNumber: blocks[0]!.from });
    await closeDay(w.owner, { date: localDate(new Date(bill.billedAt), w.tz), countedCash: 0, note: "closed" });
    expect(await syncOfflineBill(w.cashier, { ...signed, bill })).toMatchObject({ ok: false, code: "DAY_CLOSED" });
    expect(await db.invoice.count({ where: { businessId: w.businessId } })).toBe(0);
    await db.dayClose.deleteMany({ where: { businessId: w.businessId } }); // the owner reopens the day
    expect(await syncOfflineBill(w.cashier, { ...signed, bill })).toMatchObject({ ok: true });
  });

  it("records every unused number as a gap when the owner closes a block, and a late bill takes its gap's place", async () => {
    const w = await makeWorld("itest-offline-gap");
    const signed = await makeSnapshot(w.cashier);
    const d = device();
    const { blocks } = await prepareDeviceBlocks(w.cashier, d);
    const blk = blocks[0]!;
    // the phone used its first three numbers
    for (let i = 0; i < 3; i++) expect(await syncOfflineBill(w.cashier, { ...signed, bill: billFor(signed, { deviceId: d, invoiceNumber: blk.from + i }) })).toMatchObject({ ok: true });
    await expect(closeBlock(w.cashier, blk.id, "lost phone")).rejects.toThrow(/Only the owner/);
    await expect(closeBlock(w.owner, blk.id, "x")).rejects.toThrow(/Say why/);
    await closeBlock(w.owner, blk.id, "phone was lost");
    const gaps = await listGaps(w.owner);
    expect(gaps).toHaveLength(BLOCK_SIZE - 3);
    expect(gaps[0]).toMatchObject({ number: blk.from + 3, reason: "Not used: phone was lost" });
    expect(gaps[gaps.length - 1]!.number).toBe(blk.to);
    await expect(closeBlock(w.owner, blk.id, "again please")).rejects.toThrow(/already closed/);
    const row = (await listBlocks(w.owner)).find((x) => x.id === blk.id)!;
    expect(row).toMatchObject({ status: "CLOSED", invoiced: 3, gaps: BLOCK_SIZE - 3 });

    // every number is either an invoice or a gap
    const invoices = await db.invoice.findMany({ where: { businessId: w.businessId }, select: { number: true } });
    const accounted = new Set([...invoices.map((i) => i.number), ...gaps.map((g) => g.number)]);
    for (let nn = blk.from; nn <= blk.to; nn++) expect(accounted.has(nn)).toBe(true);

    // the lost phone turns up and sends a bill made with one of those numbers
    const late = billFor(signed, { deviceId: d, invoiceNumber: blk.from + 10 });
    expect(await syncOfflineBill(w.cashier, { ...signed, bill: late })).toMatchObject({ ok: true, invoiceNumber: blk.from + 10 });
    expect((await listGaps(w.owner)).some((g) => g.number === blk.from + 10)).toBe(false);
    expect(await listGaps(w.owner)).toHaveLength(BLOCK_SIZE - 4);
    await expect(listGaps(w.cashier)).rejects.toThrow(/Only the owner/);
    expect(await listGaps(b.owner)).toEqual([]); // another business has none of it
  });
});
