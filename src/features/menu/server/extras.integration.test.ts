import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { makeStockItem } from "@/features/stock/server/test-support";
import type { TenantContext } from "@/server/auth";
import { addItem, checkout, createOrder, getOrder, kitchenTickets, listMenu, previewBill, setDeliveryStatus } from "@/features/orders/server/service";
import { splitOrder } from "@/features/orders/server/table-ops";
import { acceptSubmission, getGuestView, getInbox, openSession, submitOrder } from "@/features/guest/server/service";
import { listNotifications } from "@/features/notifications/server/service";
import { addOnsForMenu, archiveAddOn, createAddOn, createGroup, listAddOnGroups, setGroupItems } from "./addons";
import { addSchedule, createMenuSet, deleteMenuSet, orderableItemIds, setActiveMenuSet, setMenuSetItems } from "./menu-sets";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  owner: TenantContext;
  waiter: TenantContext;
  tableToken: string;
  burger: string;
  momo: string;
  tea: string;
}

async function makeWorld(name: string): Promise<World> {
  const user = await db.user.create({ data: { email: `${name}-${stamp}@it.test`, name, passwordHash: "x" } });
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main branch" } });
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const table = await db.diningTable.create({ data: { businessId: biz.id, branchId: branch.id, areaId: area.id, label: "G1" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const mk = (n2: string, price: number) => db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: n2, price } });
  const [burger, momo, tea] = await Promise.all([mk("Burger", 30_000), mk("Momo", 20_000), mk("Tea", 8_000)]);
  const base = { userId: user.id, businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, role: "OWNER" },
    waiter: { ...base, role: "WAITER" },
    tableToken: table.publicToken,
    burger: burger.id,
    momo: momo.id,
    tea: tea.id,
  };
}

const newOrder = (ctx: TenantContext, extra: Partial<Parameters<typeof createOrder>[1]> = {}) =>
  createOrder(ctx, { type: "TAKEAWAY", idempotencyKey: `k-${uid()}-${stamp}`, ...extra });

let w: World;
let other: World;

beforeAll(async () => {
  w = await makeWorld("itest-extras-a");
  other = await makeWorld("itest-extras-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.branch.updateMany({ where: { businessId: id }, data: { activeMenuSetId: null } });
    await db.orderItemAddOn.deleteMany({ where: { businessId: id } });
    await db.payment.deleteMany({ where: { businessId: id } });
    await db.invoice.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.guestSubmission.deleteMany({ where: { businessId: id } });
    await db.tableSession.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("add-ons and extras", () => {
  let sizeId: string;
  let small: string;
  let large: string;
  let extrasId: string;
  let cheese: string;

  it("only managers can manage them", async () => {
    await expect(createGroup(w.waiter, { name: "Size", required: true, multiple: false })).rejects.toThrow(/permission/i);
  });

  it("creates groups and choices, with unique names", async () => {
    const size = await createGroup(w.owner, { name: "Size", required: true, multiple: false });
    sizeId = size.id;
    small = (await createAddOn(w.owner, size.id, { name: "Small", price: 0 })).id;
    large = (await createAddOn(w.owner, size.id, { name: "Large", price: 5_000 })).id;
    const extras = await createGroup(w.owner, { name: "Extras", required: false, multiple: true });
    extrasId = extras.id;
    cheese = (await createAddOn(w.owner, extras.id, { name: "Extra cheese", price: 3_000 })).id;

    await expect(createGroup(w.owner, { name: "Size", required: false, multiple: false })).rejects.toThrow(/already exists/);
    await expect(createAddOn(w.owner, size.id, { name: "Large", price: 1 })).rejects.toThrow(/already exists/);
    await expect(createAddOn(w.owner, size.id, { name: "Huge", price: -1 })).rejects.toThrow(/price/i);

    await setGroupItems(w.owner, size.id, [w.burger]);
    await setGroupItems(w.owner, extras.id, [w.burger, w.momo]);
    expect((await listAddOnGroups(w.owner)).map((g) => g.name).sort()).toEqual(["Extras", "Size"]);
  });

  it("another business cannot see, use or assign them", async () => {
    expect(await listAddOnGroups(other.owner).then((g) => g.length)).toBe(0);
    await expect(setGroupItems(other.owner, sizeId, [other.burger])).rejects.toThrow(/not found/i);
    await expect(createAddOn(other.owner, sizeId, { name: "Sneaky", price: 0 })).rejects.toThrow(/not found/i);
    // and a dish from another business cannot be attached to our group
    await expect(setGroupItems(w.owner, sizeId, [other.burger])).rejects.toThrow(/not found/i);
  });

  it("adds the chosen extras to the line price and keeps a copy of what was chosen", async () => {
    const order = await newOrder(w.waiter);
    const item = await addItem(w.waiter, order.id, { menuItemId: w.burger, quantity: 2, addOnIds: [large, cheese] });
    expect(item.unitPrice).toBe(30_000 + 5_000 + 3_000);

    const full = await getOrder(w.waiter, order.id);
    expect(full!.items[0]!.addOns.map((a) => a.name).sort()).toEqual(["Extra cheese", "Large"]);
    // the bill follows the line price
    const bill = await previewBill(w.waiter, order.id, { kind: "none" });
    expect(bill.subtotal).toBe(2 * 38_000);
  });

  it("enforces required and single-choice groups, and refuses foreign options", async () => {
    const order = await newOrder(w.waiter);
    await expect(addItem(w.waiter, order.id, { menuItemId: w.burger, quantity: 1 })).rejects.toThrow(/Size/);
    await expect(addItem(w.waiter, order.id, { menuItemId: w.burger, quantity: 1, addOnIds: [small, large] })).rejects.toThrow(/only one/);
    // cheese belongs to Extras, which Tea does not use
    await expect(addItem(w.waiter, order.id, { menuItemId: w.tea, quantity: 1, addOnIds: [cheese] })).rejects.toThrow(/not available/);
    // momo only has the optional extras group
    await expect(addItem(w.waiter, order.id, { menuItemId: w.momo, quantity: 1 })).resolves.toBeTruthy();
    expect(extrasId).toBeTruthy();
  });

  it("shows the choices on the kitchen ticket and copies them when a line is split", async () => {
    const order = await newOrder(w.waiter, { type: "DINE_IN", tableId: (await db.diningTable.findFirstOrThrow({ where: { businessId: w.owner.businessId } })).id });
    const line = await addItem(w.waiter, order.id, { menuItemId: w.burger, quantity: 3, addOnIds: [small, cheese] });
    await addItem(w.waiter, order.id, { menuItemId: w.tea, quantity: 1 });

    const ticket = (await kitchenTickets(w.waiter)).find((t) => t.id === line.id)!;
    expect(ticket.addOns.map((a) => a.name).sort()).toEqual(["Extra cheese", "Small"]);

    const part = await splitOrder(w.owner, order.id, [{ itemId: line.id, quantity: 1 }], `split-${uid()}-${stamp}`);
    const moved = (await getOrder(w.owner, part.id))!.items[0]!;
    expect(moved.quantity).toBe(1);
    expect(moved.unitPrice).toBe(33_000);
    expect(moved.addOns.map((a) => a.name).sort()).toEqual(["Extra cheese", "Small"]);
  });

  it("removing a choice does not change old orders and stops it being offered", async () => {
    const order = await newOrder(w.waiter);
    await addItem(w.waiter, order.id, { menuItemId: w.momo, quantity: 1, addOnIds: [cheese] });
    await archiveAddOn(w.owner, cheese);
    expect((await getOrder(w.waiter, order.id))!.items[0]!.addOns.map((a) => a.name)).toEqual(["Extra cheese"]);
    const offered = (await addOnsForMenu(w.waiter)).get(w.momo) ?? [];
    expect(offered).toEqual([]);
    await expect(addItem(w.waiter, order.id, { menuItemId: w.momo, quantity: 1, addOnIds: [cheese] })).rejects.toThrow(/not available/);
  });

  it("guests see the same choices, are priced on the server, and staff see them when accepting", async () => {
    await db.business.update({ where: { id: w.owner.businessId }, data: { requireOrderApproval: true } });
    const gc = await openSession(w.tableToken);
    const view = await getGuestView(gc);
    const burger = view.menu.flatMap((c) => c.items).find((i) => i.name === "Burger")!;
    // Extras has no choices left (its only one was switched off earlier), so only Size is offered
    expect(burger.groups.map((g) => g.name)).toEqual(["Size"]);

    // a required choice cannot be skipped, and a foreign option is refused
    await expect(submitOrder(gc, { items: [{ menuItemId: w.burger, quantity: 1 }], idempotencyKey: `g-${uid()}-${stamp}` })).rejects.toThrow(/Size/);
    await expect(
      submitOrder(gc, { items: [{ menuItemId: w.tea, quantity: 1, addOnIds: [small] }], idempotencyKey: `g-${uid()}-${stamp}` }),
    ).rejects.toThrow(/not available/);

    const sub = await submitOrder(gc, {
      items: [{ menuItemId: w.burger, quantity: 2, addOnIds: [large] }],
      idempotencyKey: `g-${uid()}-${stamp}`,
    });
    const row = await db.guestSubmissionItem.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect(row.unitPrice).toBe(35_000); // 30,000 + Large 5,000, worked out here, not trusted from the phone
    expect(row.addOnIds).toEqual([large]);

    const inbox = await getInbox(w.owner);
    expect(inbox.submissions.find((x) => x.id === sub.id)!.items[0]!.addOnNames).toEqual(["Large"]);

    await acceptSubmission(w.owner, sub.id);
    const tableId = (await db.guestSubmission.findUniqueOrThrow({ where: { id: sub.id } })).tableId;
    const order = await db.order.findFirstOrThrow({
      where: { businessId: w.owner.businessId, tableId, status: { in: ["OPEN", "SERVED"] } },
      include: { items: { include: { addOns: true } } },
    });
    // the table already has an open bill from an earlier test: pick the line that came from this guest order
    const line = order.items.find((i) => i.addOns.some((x) => x.addOnId === large))!;
    expect(line.unitPrice).toBe(35_000);
    expect(line.addOns.map((a) => a.name)).toEqual(["Large"]);
    expect(line.addOns[0]!.addOnId).toBe(large);
  });

  it("refuses to accept a guest order whose choice was switched off meanwhile", async () => {
    const gc = await openSession(w.tableToken);
    const sub = await submitOrder(gc, {
      items: [{ menuItemId: w.burger, quantity: 1, addOnIds: [small] }],
      idempotencyKey: `g-${uid()}-${stamp}`,
    });
    await archiveAddOn(w.owner, small);
    await expect(acceptSubmission(w.owner, sub.id)).rejects.toThrow(/options have changed/i);
    // the failed accept did not leave it half-taken
    expect((await db.guestSubmission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("PENDING");
  });
});

describe("menu sets and schedules", () => {
  it("limits ordering to the active set, for staff and guests", async () => {
    const breakfast = await createMenuSet(w.owner, "Breakfast");
    await expect(createMenuSet(w.owner, "Breakfast")).rejects.toThrow(/already exists/);
    await setMenuSetItems(w.owner, breakfast.id, [w.tea]);
    await expect(setMenuSetItems(w.owner, breakfast.id, [other.tea])).rejects.toThrow(/not found/i);

    // nothing active yet: whole menu
    expect(await orderableItemIds(db, w.owner.businessId, w.owner.branchId)).toBeNull();

    await setActiveMenuSet(w.owner, breakfast.id);
    expect([...(await orderableItemIds(db, w.owner.businessId, w.owner.branchId))!]).toEqual([w.tea]);

    const order = await newOrder(w.waiter);
    await expect(addItem(w.waiter, order.id, { menuItemId: w.momo, quantity: 1 })).rejects.toThrow(/not on the menu/i);
    await expect(addItem(w.waiter, order.id, { menuItemId: w.tea, quantity: 1 })).resolves.toBeTruthy();
    expect((await listMenu(w.waiter)).flatMap((c) => c.items.map((i) => i.name))).toEqual(["Tea"]);

    const gc = await openSession(w.tableToken);
    expect((await getGuestView(gc)).menu.flatMap((c) => c.items.map((i) => i.name))).toEqual(["Tea"]);
    await expect(submitOrder(gc, { items: [{ menuItemId: w.momo, quantity: 1 }], idempotencyKey: `g-${uid()}-${stamp}` })).rejects.toThrow(/no longer available/i);

    // another business is unaffected, and cannot pick our set
    expect(await orderableItemIds(db, other.owner.businessId, other.owner.branchId)).toBeNull();
    await expect(setActiveMenuSet(other.owner, breakfast.id)).rejects.toThrow(/not found/i);

    // deleting the active set puts the whole menu back
    await deleteMenuSet(w.owner, breakfast.id);
    expect(await orderableItemIds(db, w.owner.businessId, w.owner.branchId)).toBeNull();
  });

  it("follows the weekly schedule and refuses overlapping times", async () => {
    const lunch = await createMenuSet(w.owner, "Lunch");
    await setMenuSetItems(w.owner, lunch.id, [w.momo]);
    // every day, all day, so the test does not depend on the clock
    for (let d = 0; d < 7; d++) await addSchedule(w.owner, { menuSetId: lunch.id, dayOfWeek: d, start: "00:00", end: "23:59" });
    expect([...(await orderableItemIds(db, w.owner.businessId, w.owner.branchId))!]).toEqual([w.momo]);

    await expect(addSchedule(w.owner, { menuSetId: lunch.id, dayOfWeek: 1, start: "10:00", end: "11:00" })).rejects.toThrow(/overlaps/);
    await expect(addSchedule(w.owner, { menuSetId: lunch.id, dayOfWeek: 1, start: "11:00", end: "10:00" })).rejects.toThrow(/after/);
    await expect(addSchedule(w.owner, { menuSetId: lunch.id, dayOfWeek: 9, start: "10:00", end: "11:00" })).rejects.toThrow(/day/i);

    // a hand-picked "whole menu"... is not possible, but clearing the choice follows the schedule
    await setActiveMenuSet(w.owner, null);
    expect(await orderableItemIds(db, w.owner.businessId, w.owner.branchId)).not.toBeNull();
    await deleteMenuSet(w.owner, lunch.id);
    expect(await db.menuSchedule.count({ where: { businessId: w.owner.businessId } })).toBe(0);
  });

  it("only managers can change menu sets", async () => {
    await expect(createMenuSet(w.waiter, "Sneaky")).rejects.toThrow(/permission/i);
  });
});

describe("delivery orders", () => {
  it("needs a phone and an address, and starts as preparing", async () => {
    await expect(newOrder(w.waiter, { type: "DELIVERY", delivery: { phone: "123", address: "House 4, Lakeside" } })).rejects.toThrow(/phone/i);
    await expect(newOrder(w.waiter, { type: "DELIVERY", delivery: { phone: "9841234567", address: "x" } })).rejects.toThrow(/address/i);
    const order = await newOrder(w.waiter, {
      type: "DELIVERY",
      delivery: { name: "Sita", phone: "9841234567", address: "House 4, Lakeside" },
    });
    expect(order).toMatchObject({ type: "DELIVERY", deliveryStatus: "PREPARING", deliveryName: "Sita", tableId: null });
  });

  it("moves preparing, out, delivered with a rider, and refuses skipping", async () => {
    const order = await newOrder(w.waiter, { type: "DELIVERY", delivery: { phone: "9841234567", address: "House 4, Lakeside" } });
    await expect(setDeliveryStatus(w.waiter, order.id, { status: "DELIVERED" })).rejects.toThrow(/cannot move/i);
    await expect(setDeliveryStatus(w.waiter, order.id, { status: "OUT_FOR_DELIVERY" })).rejects.toThrow(/rider/i);
    await setDeliveryStatus(w.waiter, order.id, { status: "OUT_FOR_DELIVERY", riderName: "Ram" });
    await setDeliveryStatus(w.waiter, order.id, { status: "DELIVERED" });
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ deliveryStatus: "DELIVERED", riderName: "Ram" });
    await expect(setDeliveryStatus(w.waiter, order.id, { status: "FAILED" })).rejects.toThrow(/cannot move/i);
  });

  it("is paid like any other bill, and a takeaway order is not a delivery", async () => {
    const order = await newOrder(w.waiter, { type: "DELIVERY", delivery: { phone: "9841234567", address: "House 4, Lakeside" } });
    await addItem(w.waiter, order.id, { menuItemId: w.tea, quantity: 2 });
    const t = await previewBill(w.waiter, order.id, { kind: "none" });
    const invoice = await checkout(w.owner, order.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
    expect(invoice.grandTotal).toBe(t.grandTotal);

    const takeaway = await newOrder(w.waiter);
    await expect(setDeliveryStatus(w.waiter, takeaway.id, { status: "OUT_FOR_DELIVERY", riderName: "Ram" })).rejects.toThrow(/not found/i);
  });

  it("is not reachable from another business", async () => {
    const order = await newOrder(w.waiter, { type: "DELIVERY", delivery: { phone: "9841234567", address: "House 4, Lakeside" } });
    await expect(setDeliveryStatus(other.owner, order.id, { status: "OUT_FOR_DELIVERY", riderName: "Ram" })).rejects.toThrow(/not found/i);
  });
});

describe("notifications", () => {
  it("lists guest orders, low stock and open bills for those who can act, and nothing across businesses", async () => {
    await makeStockItem(w.owner.businessId, w.owner.branchId, { name: "Flour", unit: "g", quantity: 100, reorderLevel: 500 });
    const mine = await listNotifications(w.owner);
    expect(mine.some((x) => x.kind === "LOW_STOCK" && x.title.includes("Flour"))).toBe(true);
    expect(mine.every((x) => x.id)).toBe(true);
    // alerts come before warnings
    const levels = mine.map((x) => x.level);
    expect(levels).toEqual([...levels].sort((a, b) => ({ alert: 0, warn: 1, info: 2 })[a] - ({ alert: 0, warn: 1, info: 2 })[b]));

    const theirs = await listNotifications(other.owner);
    expect(theirs.some((x) => x.title.includes("Flour"))).toBe(false);

    // a waiter cannot see stock notifications
    expect((await listNotifications(w.waiter)).some((x) => x.kind === "LOW_STOCK")).toBe(false);
    await db.stockItem.deleteMany({ where: { businessId: w.owner.businessId } });
  });
});
