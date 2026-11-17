import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { scope } from "@/server/branch";
import { addItem, checkout, createOrder, getOrder, listOpenOrders, listTables, previewBill } from "@/features/orders/server/service";
import { mergeOrders, moveToTable } from "@/features/orders/server/table-ops";
import { cancelOrder, refundInvoice } from "@/features/orders/server/void";
import { closeDay, getDayReport } from "@/features/reports/server/service";
import { createBranch, listMyBranches, setBranchActive, setStaffBranches, updateBranch } from "./service";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  /** Owner, working in the first branch. */
  owner: TenantContext;
  /** Same owner, switched to the second branch. */
  ownerAtB: TenantContext;
  /** A cashier who may only work in branch A. */
  cashierA: TenantContext;
  branchA: string;
  branchB: string;
  momo: string;
  cashierMembershipId: string;
}

async function makeWorld(name: string): Promise<World> {
  const user = await db.user.create({ data: { email: `${name}-${stamp}@it.test`, name, passwordHash: "x" } });
  const cashier = await db.user.create({ data: { email: `${name}-cashier-${stamp}@it.test`, name: "Cashier", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const a = await db.branch.create({ data: { businessId: biz.id, name: "Branch A" } });
  const b = await db.branch.create({ data: { businessId: biz.id, name: "Branch B" } });
  const membership = await db.membership.create({
    data: { userId: cashier.id, businessId: biz.id, role: "CASHIER", allBranches: false, branches: { create: { branchId: a.id, businessId: biz.id } } },
  });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Momo", price: 20_000 } });
  const both = [a.id, b.id];
  return {
    owner: { userId: user.id, businessId: biz.id, branchId: a.id, branchIds: both, role: "OWNER" },
    ownerAtB: { userId: user.id, businessId: biz.id, branchId: b.id, branchIds: both, role: "OWNER" },
    cashierA: { userId: cashier.id, businessId: biz.id, branchId: a.id, branchIds: [a.id], role: "CASHIER" },
    branchA: a.id,
    branchB: b.id,
    momo: momo.id,
    cashierMembershipId: membership.id,
  };
}

/** A table in the given branch (its own area). */
async function tableIn(w: World, branchId: string) {
  const area = await db.area.create({ data: { businessId: w.owner.businessId, branchId, name: `Area ${uid()}` } });
  return db.diningTable.create({ data: { businessId: w.owner.businessId, branchId, areaId: area.id, label: `T${uid()}` } });
}

async function seat(w: World, ctx: TenantContext, qty = 1) {
  const table = await tableIn(w, ctx.branchId);
  const order = await createOrder(ctx, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
  await addItem(ctx, order.id, { menuItemId: w.momo, quantity: qty });
  return { table, order };
}

async function pay(ctx: TenantContext, orderId: string) {
  const t = await previewBill(ctx, orderId, { kind: "none" });
  return checkout(ctx, orderId, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
}

let w: World;
let other: World;

beforeAll(async () => {
  w = await makeWorld("itest-branch-a");
  other = await makeWorld("itest-branch-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.dayClose.deleteMany({ where: { businessId: id } });
    await db.refundPayment.deleteMany({ where: { businessId: id } });
    await db.creditNote.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("branch scope", () => {
  it("fails closed when a request has no branch", () => {
    expect(() => scope({ ...w.owner, branchId: "" })).toThrow();
    expect(scope(w.owner)).toEqual({ businessId: w.owner.businessId, branchId: w.branchA });
  });
});

describe("working in one branch at a time", () => {
  it("lists only this branch's tables and open bills", async () => {
    const inA = await seat(w, w.owner);
    const inB = await seat(w, w.ownerAtB);

    const ordersA = (await listOpenOrders(w.owner)).map((o) => o.id);
    const ordersB = (await listOpenOrders(w.ownerAtB)).map((o) => o.id);
    expect(ordersA).toContain(inA.order.id);
    expect(ordersA).not.toContain(inB.order.id);
    expect(ordersB).toContain(inB.order.id);
    expect(ordersB).not.toContain(inA.order.id);

    const tablesA = (await listTables(w.owner)).map((t) => t.id);
    expect(tablesA).toContain(inA.table.id);
    expect(tablesA).not.toContain(inB.table.id);
  });

  it("cannot read, change, pay or cancel a bill from another branch", async () => {
    const inB = await seat(w, w.ownerAtB);
    expect(await getOrder(w.owner, inB.order.id)).toBeNull();
    await expect(addItem(w.owner, inB.order.id, { menuItemId: w.momo, quantity: 1 })).rejects.toThrow(/not found/i);
    await expect(
      checkout(w.owner, inB.order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: 1 }] }),
    ).rejects.toThrow();
    await expect(cancelOrder(w.owner, inB.order.id, "not mine")).rejects.toThrow(/not found/i);
    // untouched
    expect((await db.order.findUniqueOrThrow({ where: { id: inB.order.id } })).status).toBe("OPEN");
  });

  it("cannot open an order on another branch's table", async () => {
    const tableB = await tableIn(w, w.branchB);
    await expect(
      createOrder(w.owner, { type: "DINE_IN", tableId: tableB.id, idempotencyKey: `k-${uid()}-${stamp}` }),
    ).rejects.toThrow(/table not found/i);
  });

  it("cannot move or merge across branches", async () => {
    const inA = await seat(w, w.owner);
    const inB = await seat(w, w.ownerAtB);
    const freeB = await tableIn(w, w.branchB);
    await expect(moveToTable(w.owner, inA.order.id, freeB.id)).rejects.toThrow(/table not found/i);
    await expect(mergeOrders(w.owner, inA.order.id, inB.order.id)).rejects.toThrow(/not found/i);
    expect((await db.order.findUniqueOrThrow({ where: { id: inA.order.id } })).tableId).toBe(inA.table.id);
  });

  it("stamps new orders and invoices with the branch they were made in", async () => {
    const { order } = await seat(w, w.ownerAtB);
    expect(order.branchId).toBe(w.branchB);
    const invoice = await pay(w.ownerAtB, order.id);
    expect(invoice.branchId).toBe(w.branchB);
  });

  it("a repeated order key from another branch does not leak the first order", async () => {
    const table = await tableIn(w, w.branchA);
    const key = `k-${uid()}-${stamp}`;
    await createOrder(w.owner, { type: "DINE_IN", tableId: table.id, idempotencyKey: key });
    await expect(createOrder(w.ownerAtB, { type: "DINE_IN", tableId: table.id, idempotencyKey: key })).rejects.toThrow();
  });
});

describe("each branch keeps its own day", () => {
  it("reports only its own sales, and closing one branch does not lock the other", async () => {
    // its own business: other tests leave open bills behind, which would block closing the day
    const d = await makeWorld("itest-branch-day");
    const x = await seat(d, d.owner, 2);
    const y = await seat(d, d.ownerAtB, 1);
    const invA = await pay(d.owner, x.order.id);
    const invB = await pay(d.ownerAtB, y.order.id);

    const repA = (await getDayReport(d.owner)).report;
    const repB = (await getDayReport(d.ownerAtB)).report;
    const sold = async (branchId: string) =>
      (await db.invoice.findMany({ where: { businessId: d.owner.businessId, branchId } })).reduce((s, i) => s + i.grandTotal, 0);
    expect(invA.branchId).toBe(d.branchA);
    expect(repA.sales.gross).toBe(await sold(d.branchA));
    expect(repB.sales.gross).toBe(await sold(d.branchB));
    expect(repB.sales.gross).toBeGreaterThanOrEqual(invB.grandTotal);

    // Count exactly what each branch sold so far today, then close A with the right cash.
    const todayA = (await getDayReport(d.owner)).date;
    await closeDay(d.owner, { date: todayA, countedCash: repA.expectedCash });

    // A is locked...
    const more = await seat(d, d.owner);
    await expect(pay(d.owner, more.order.id)).rejects.toThrow(/closed/i);
    // ...B is not.
    const moreB = await seat(d, d.ownerAtB);
    await expect(pay(d.ownerAtB, moreB.order.id)).resolves.toBeTruthy();
    expect((await getDayReport(d.ownerAtB)).dayClose).toBeNull();
    expect((await getDayReport(d.owner)).dayClose).not.toBeNull();

    // Refunds are blocked in the closed branch, allowed in the open one.
    await expect(refundInvoice(d.owner, invA.id, "closed day")).rejects.toThrow(/closed/i);
    await expect(refundInvoice(d.ownerAtB, invB.id, "customer unhappy")).resolves.toBeTruthy();
    // A refund of branch B's invoice cannot be made from branch A.
    const invB2 = await pay(d.ownerAtB, (await seat(d, d.ownerAtB)).order.id);
    await expect(refundInvoice(d.cashierA, invB2.id, "wrong branch")).rejects.toThrow();
  });
});

describe("managing branches", () => {
  it("only the owner can add or rename branches; names are unique per business", async () => {
    await expect(createBranch(w.cashierA, { name: "Sneaky" })).rejects.toThrow(/owner/i);
    const c = await createBranch(w.owner, { name: "Branch C", address: "Lakeside" });
    expect(c.address).toBe("Lakeside");
    await expect(createBranch(w.owner, { name: "Branch C" })).rejects.toThrow(/already/i);
    await updateBranch(w.owner, c.id, { name: "Branch C2" });
    await expect(updateBranch(other.owner, c.id, { name: "Hijack" })).rejects.toThrow(/not found/i);
    // the same name is fine in a different business
    await expect(createBranch(other.owner, { name: "Branch C2" })).resolves.toBeTruthy();
  });

  it("cannot switch off the last active branch or one with open bills, and never another business's branch", async () => {
    const solo = await makeWorld("itest-branch-solo");
    await setBranchActive(solo.owner, solo.branchB, false);
    await expect(setBranchActive(solo.owner, solo.branchA, false)).rejects.toThrow(/at least one/i);
    await setBranchActive(solo.owner, solo.branchB, true);

    await seat(solo, solo.ownerAtB);
    await expect(setBranchActive(solo.owner, solo.branchB, false)).rejects.toThrow(/still open/i);
    await expect(setBranchActive(other.owner, solo.branchA, false)).rejects.toThrow(/not found/i);
  });

  it("a restricted team member only sees their branches", async () => {
    expect((await listMyBranches(w.cashierA)).map((b) => b.id)).toEqual([w.branchA]);
    expect((await listMyBranches(w.owner)).map((b) => b.id).sort()).toEqual([w.branchA, w.branchB].sort());
  });

  it("access changes are owner only, validated, and stay inside the business", async () => {
    await expect(setStaffBranches(w.cashierA, w.cashierMembershipId, { allBranches: true, branchIds: [] })).rejects.toThrow(/owner/i);
    await expect(setStaffBranches(w.owner, w.cashierMembershipId, { allBranches: false, branchIds: [] })).rejects.toThrow(/at least one/i);
    // a branch from another business is refused
    await expect(
      setStaffBranches(w.owner, w.cashierMembershipId, { allBranches: false, branchIds: [other.branchA] }),
    ).rejects.toThrow(/not available/i);
    // and a membership from another business cannot be edited
    await expect(setStaffBranches(other.owner, w.cashierMembershipId, { allBranches: true, branchIds: [] })).rejects.toThrow(/not found/i);

    await setStaffBranches(w.owner, w.cashierMembershipId, { allBranches: false, branchIds: [w.branchA, w.branchB] });
    const rows = await db.membershipBranch.findMany({ where: { membershipId: w.cashierMembershipId } });
    expect(rows.map((r) => r.branchId).sort()).toEqual([w.branchA, w.branchB].sort());
    await setStaffBranches(w.owner, w.cashierMembershipId, { allBranches: true, branchIds: [w.branchA] });
    expect(await db.membershipBranch.count({ where: { membershipId: w.cashierMembershipId } })).toBe(0);
    expect((await db.membership.findUniqueOrThrow({ where: { id: w.cashierMembershipId } })).allBranches).toBe(true);
    // put it back for the other tests
    await setStaffBranches(w.owner, w.cashierMembershipId, { allBranches: false, branchIds: [w.branchA] });
  });
});
