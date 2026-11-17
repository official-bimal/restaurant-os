import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { addItem, checkout, createOrder, getOrder, previewBill } from "@/features/orders/server/service";
import { resetTableQr, setGuestSettings } from "@/features/floor/server/service";
import {
  acceptSubmission,
  completeRequest,
  getGuestView,
  getInbox,
  lookupTable,
  openSession,
  rejectSubmission,
  requestService,
  resolveGuest,
  submitOrder,
} from "./service";

const businessIds: string[] = [];
const stamp = Date.now();

interface World {
  staff: TenantContext;
  token: string;
  tableId: string;
  momo: string;
  tea: string;
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
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Tea", price: 8_000 } });
  return {
    staff: { userId: user.id, businessId: biz.id, branchId: branch.id, branchIds: [branch.id], role: "OWNER" },
    token: table.publicToken,
    tableId: table.id,
    momo: momo.id,
    tea: tea.id,
  };
}

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-guest-a");
  b = await makeWorld("itest-guest-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("QR tokens and sittings", () => {
  it("looks up a table only by its exact secret token", async () => {
    expect((await lookupTable(a.token))?.tableLabel).toBe("T1");
    expect(await lookupTable("0".repeat(64))).toBeNull();
    expect(await lookupTable("short")).toBeNull();
    expect(await lookupTable(a.tableId)).toBeNull(); // the table id is not a credential
  });

  it("gives everyone at a table the same open sitting, and other tables their own", async () => {
    const one = await openSession(a.token);
    const two = await openSession(a.token);
    expect(two.sessionId).toBe(one.sessionId);
    const other = await openSession(b.token);
    expect(other.sessionId).not.toBe(one.sessionId);
    expect(other.businessId).toBe(b.staff.businessId);
  });

  it("refuses to open a sitting when guest ordering is off", async () => {
    await setGuestSettings(b.staff, { enabled: false, requireApproval: true });
    await expect(openSession(b.token)).rejects.toThrow("not available");
    await setGuestSettings(b.staff, { enabled: true, requireApproval: true });
  });

  it("binds a guest cookie to its own table", async () => {
    const s = await openSession(a.token);
    expect(await resolveGuest({ sessionId: s.sessionId, tableId: s.tableId })).not.toBeNull();
    expect(await resolveGuest({ sessionId: s.sessionId, tableId: b.tableId })).toBeNull();
    expect(await resolveGuest({ sessionId: "nope", tableId: s.tableId })).toBeNull();
    expect(await resolveGuest(null)).toBeNull();
  });
});

describe("guest orders with approval", () => {
  let gc: Awaited<ReturnType<typeof openSession>>;
  let firstId: string;

  beforeAll(async () => {
    gc = await openSession(a.token);
  });

  it("submits once even if the button is tapped twice", async () => {
    const input = { items: [{ menuItemId: a.momo, quantity: 2 }], idempotencyKey: "guest-key-0001" };
    const first = await submitOrder(gc, input);
    const second = await submitOrder(gc, input);
    expect(second.id).toBe(first.id);
    expect(first.status).toBe("PENDING");
    firstId = first.id;
    expect(await db.guestSubmission.count({ where: { businessId: a.staff.businessId } })).toBe(1);
    // nothing reaches the kitchen until staff accept
    expect(await db.order.count({ where: { businessId: a.staff.businessId } })).toBe(0);
  });

  it("validates the cart and only allows this business's available dishes", async () => {
    const bad = (items: { menuItemId: string; quantity: number }[], key: string) =>
      submitOrder(gc, { items, idempotencyKey: key });
    await expect(bad([], "guest-key-0002")).rejects.toThrow("empty");
    await expect(bad([{ menuItemId: a.momo, quantity: 0 }], "guest-key-0003")).rejects.toThrow("between 1 and");
    await expect(bad([{ menuItemId: a.momo, quantity: 21 }], "guest-key-0004")).rejects.toThrow("between 1 and");
    await expect(bad([{ menuItemId: b.momo, quantity: 1 }], "guest-key-0005")).rejects.toThrow("no longer available"); // another business's dish
    await db.menuItem.update({ where: { id: a.tea }, data: { available: false } });
    await expect(bad([{ menuItemId: a.tea, quantity: 1 }], "guest-key-0006")).rejects.toThrow("no longer available");
    await db.menuItem.update({ where: { id: a.tea }, data: { available: true } });
    await expect(submitOrder(gc, { items: [{ menuItemId: a.momo, quantity: 1 }], idempotencyKey: "x" })).rejects.toThrow(DomainError);
  });

  it("caps how many orders can be waiting at once", async () => {
    await submitOrder(gc, { items: [{ menuItemId: a.tea, quantity: 1 }], idempotencyKey: "guest-key-0007" });
    await submitOrder(gc, { items: [{ menuItemId: a.tea, quantity: 1 }], idempotencyKey: "guest-key-0008" });
    await expect(
      submitOrder(gc, { items: [{ menuItemId: a.tea, quantity: 1 }], idempotencyKey: "guest-key-0009" }),
    ).rejects.toThrow("still waiting");
    for (const s of (await getInbox(a.staff)).submissions.filter((s) => s.id !== firstId)) {
      await rejectSubmission(a.staff, s.id, "test cleanup");
    }
  });

  it("keeps businesses apart for staff", async () => {
    await expect(acceptSubmission(b.staff, firstId)).rejects.toThrow("already handled");
    await expect(rejectSubmission(b.staff, firstId)).rejects.toThrow("already handled");
    expect((await getInbox(b.staff)).submissions).toHaveLength(0);
  });

  it("accepting creates the table's order, a second one joins it, and a double accept is refused", async () => {
    await acceptSubmission(a.staff, firstId);
    await expect(acceptSubmission(a.staff, firstId)).rejects.toThrow("already handled");
    const order1 = await db.order.findFirstOrThrow({ where: { businessId: a.staff.businessId }, include: { items: true } });
    expect(order1.tableId).toBe(a.tableId);
    expect(order1.items).toHaveLength(1);
    expect(order1.items[0]).toMatchObject({ name: "Momo", quantity: 2, unitPrice: 20_000, status: "PENDING" });
    expect((await db.diningTable.findUniqueOrThrow({ where: { id: a.tableId } })).state).toBe("SEATED");

    const second = await submitOrder(gc, { items: [{ menuItemId: a.tea, quantity: 3 }], idempotencyKey: "guest-key-0010" });
    await acceptSubmission(a.staff, second.id);
    const orders = await db.order.findMany({ where: { businessId: a.staff.businessId }, include: { items: true } });
    expect(orders).toHaveLength(1); // joined, not a second order
    expect(orders[0].items).toHaveLength(2);
  });

  it("rejecting records a reason the guest can see", async () => {
    const s = await submitOrder(gc, { items: [{ menuItemId: a.momo, quantity: 1 }], idempotencyKey: "guest-key-0011" });
    await rejectSubmission(a.staff, s.id, "Kitchen is closed");
    const view = await getGuestView(gc);
    expect(view.submissions.find((x) => x.id === s.id)).toMatchObject({ status: "REJECTED", rejectReason: "Kitchen is closed" });
  });

  it("refuses to accept an order with a dish that has since become unavailable", async () => {
    const s = await submitOrder(gc, { items: [{ menuItemId: a.momo, quantity: 1 }], idempotencyKey: "guest-key-0012" });
    await db.menuItem.update({ where: { id: a.momo }, data: { available: false } });
    await expect(acceptSubmission(a.staff, s.id)).rejects.toThrow("No longer available");
    expect((await db.guestSubmission.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("PENDING"); // rolled back, still decidable
    await db.menuItem.update({ where: { id: a.momo }, data: { available: true } });
    await rejectSubmission(a.staff, s.id);
  });

  it("shows the guest the same total staff will bill", async () => {
    const view = await getGuestView(gc);
    const order = await db.order.findFirstOrThrow({ where: { businessId: a.staff.businessId } });
    const staffTotals = await previewBill(a.staff, order.id, { kind: "none" });
    expect(view.estimate?.grandTotal).toBe(staffTotals.grandTotal);
    expect(view.orderItems).toHaveLength(2);
  });

  it("lets only roles that handle orders manage the inbox", async () => {
    const kitchen: TenantContext = { ...a.staff, role: "KITCHEN" };
    await expect(getInbox(kitchen)).rejects.toThrow("permission");
    const waiter: TenantContext = { ...a.staff, role: "WAITER" };
    await expect(getInbox(waiter)).resolves.toBeTruthy();
  });
});

describe("service requests", () => {
  it("dedupes identical open requests, needs an order for the bill, and can be completed", async () => {
    const gc = await openSession(a.token);
    const w1 = await requestService(gc, "CALL_WAITER");
    const w2 = await requestService(gc, "CALL_WAITER");
    expect(w2.id).toBe(w1.id);
    const bill = await requestService(gc, "REQUEST_BILL"); // order exists from the earlier tests
    expect((await db.diningTable.findUniqueOrThrow({ where: { id: a.tableId } })).state).toBe("BILL_REQUESTED");
    await completeRequest(a.staff, w1.id);
    await expect(completeRequest(a.staff, w1.id)).rejects.toThrow("already handled");
    await expect(completeRequest(b.staff, bill.id)).rejects.toThrow("already handled"); // not theirs
  });

  it("refuses a bill request when nothing has been ordered", async () => {
    const gcB = await openSession(b.token);
    await expect(requestService(gcB, "REQUEST_BILL")).rejects.toThrow("nothing to bill");
    await expect(requestService(gcB, "WATER")).resolves.toBeTruthy();
  });
});

describe("approval switched off", () => {
  it("sends the guest's order straight to the kitchen", async () => {
    await setGuestSettings(b.staff, { enabled: true, requireApproval: false });
    const gc = await openSession(b.token);
    const sub = await submitOrder(gc, { items: [{ menuItemId: b.tea, quantity: 2 }], idempotencyKey: "guest-key-0020" });
    expect(sub.status).toBe("ACCEPTED");
    const order = await db.order.findFirstOrThrow({ where: { businessId: b.staff.businessId }, include: { items: true } });
    expect(order.items[0]).toMatchObject({ name: "Tea", quantity: 2 });
  });
});

describe("the sitting ends at checkout", () => {
  it("closes the sitting, clears pending work, and a new scan starts a fresh one", async () => {
    const gc = await openSession(a.token);
    const pending = await submitOrder(gc, { items: [{ menuItemId: a.tea, quantity: 1 }], idempotencyKey: "guest-key-0030" });
    const order = await db.order.findFirstOrThrow({ where: { businessId: a.staff.businessId, status: { in: ["OPEN", "SERVED"] } } });
    const totals = await previewBill(a.staff, order.id, { kind: "none" });
    await checkout(a.staff, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: totals.grandTotal }] });

    expect(await resolveGuest({ sessionId: gc.sessionId, tableId: gc.tableId })).toBeNull(); // old phone cannot order
    await expect(submitOrder(gc, { items: [{ menuItemId: a.tea, quantity: 1 }], idempotencyKey: "guest-key-0031" })).rejects.toThrow("session has ended");
    await expect(requestService(gc, "WATER")).rejects.toThrow("session has ended");
    expect((await db.guestSubmission.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("REJECTED");
    expect(await db.serviceRequest.count({ where: { businessId: a.staff.businessId, status: "OPEN" } })).toBe(0);
    expect((await getOrder(a.staff, order.id))?.status).toBe("PAID");

    const fresh = await openSession(a.token);
    expect(fresh.sessionId).not.toBe(gc.sessionId);
  });

  it("resetting a QR kills the old token and the open sitting", async () => {
    const gc = await openSession(a.token);
    const oldToken = a.token;
    await resetTableQr(a.staff, a.tableId);
    expect(await lookupTable(oldToken)).toBeNull();
    expect(await resolveGuest({ sessionId: gc.sessionId, tableId: gc.tableId })).toBeNull();
    const t = await db.diningTable.findUniqueOrThrow({ where: { id: a.tableId } });
    expect(t.publicToken).not.toBe(oldToken);
    expect(await lookupTable(t.publicToken)).not.toBeNull();
    await expect(resetTableQr(b.staff, a.tableId)).rejects.toThrow("not found");
  });
});

describe("best selling label", () => {
  async function sell(w: World, lines: { id: string; qty: number }[], pay: boolean) {
    const t = (await db.diningTable.findFirstOrThrow({ where: { id: w.tableId } }));
    const table = await db.diningTable.create({ data: { businessId: w.staff.businessId, branchId: w.staff.branchId, areaId: t.areaId, label: `B${Math.random().toString(36).slice(2, 7)}` } });
    const order = await createOrder(w.staff, { type: "DINE_IN", tableId: table.id, idempotencyKey: `best-${Math.random().toString(36).slice(2)}-${stamp}` });
    for (const l of lines) await addItem(w.staff, order.id, { menuItemId: l.id, quantity: l.qty });
    if (pay) {
      const tot = await previewBill(w.staff, order.id, { kind: "none" });
      await checkout(w.staff, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: tot.grandTotal }] });
    }
  }

  it("names only dishes really sold lately (paid bills), never counts, and only for this business", async () => {
    // dishes made for this test, so sales from other tests in this file do not count
    const cat = await db.menuCategory.findFirstOrThrow({ where: { businessId: a.staff.businessId } });
    const star = await db.menuItem.create({ data: { businessId: a.staff.businessId, categoryId: cat.id, name: "Star dish", price: 10_000 } });
    const quiet = await db.menuItem.create({ data: { businessId: a.staff.businessId, categoryId: cat.id, name: "Quiet dish", price: 10_000 } });
    const tokenOf = async (w: World) => (await db.diningTable.findUniqueOrThrow({ where: { id: w.tableId } })).publicToken; // earlier tests rotated the QR
    const view = async (w: World) => getGuestView((await openSession(await tokenOf(w))) as never);
    expect((await view(a)).bestSellerIds).not.toContain(star.id);
    await sell(a, [{ id: star.id, qty: 6 }, { id: quiet.id, qty: 2 }], true);
    await sell(a, [{ id: quiet.id, qty: 10 }], false); // an open bill does not count
    const v = await view(a);
    expect(v.bestSellerIds).toContain(star.id);
    expect(v.bestSellerIds).not.toContain(quiet.id); // only 2 sold on paid bills, below the minimum
    expect(v.bestSellerIds.every((id) => typeof id === "string")).toBe(true); // ids only: no quantity travels to the guest
    expect((await view(b)).bestSellerIds).not.toContain(star.id);
    // the owner's switch hides the whole thing
    await setGuestSettings(a.staff, { enabled: true, requireApproval: true, bestSellers: false });
    expect((await view(a)).bestSellerIds).toEqual([]);
    await setGuestSettings(a.staff, { enabled: true, requireApproval: true, bestSellers: true });
    expect((await view(a)).bestSellerIds).toContain(star.id);
    // leaving it out of an update keeps what was set
    await setGuestSettings(a.staff, { enabled: true, requireApproval: true });
    expect((await db.business.findUniqueOrThrow({ where: { id: a.staff.businessId } })).guestBestSellers).toBe(true);
    // switched off: it is no longer offered, so it is no longer called a best seller
    await db.menuItem.update({ where: { id: star.id }, data: { available: false } });
    expect((await view(a)).bestSellerIds).not.toContain(star.id);
  });
});
