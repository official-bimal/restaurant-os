import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createAddOn, createGroup, setGroupItems } from "@/features/menu/server/addons";
import { createBand, createZone } from "@/features/delivery/server/service";
import {
  acceptOnlineOrder,
  cancelOnlineOrder,
  expireStaleOnlineOrders,
  getOnlineInbox,
  getOnlineMenu,
  getOnlineSettings,
  getOnlineStatus,
  lookupBranch,
  onlineInboxCount,
  quoteDelivery,
  rejectOnlineOrder,
  rotateOnlineLink,
  saveOnlineSettings,
  submitOnlineOrder,
  type OnlineOrderInput,
} from "./service";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const key = () => `key-${stamp}-${++n}-${Math.random().toString(36).slice(2, 8)}`;
let phoneN = 0;
const phone = () => `984${String(1_000_000 + ++phoneN + (stamp % 1000) * 10)}`;

interface World {
  owner: TenantContext;
  other: TenantContext;
  kitchen: TenantContext;
  businessId: string;
  branchId: string;
  otherBranchId: string;
  token: string;
  momo: string;
  tea: string;
  thali: string;
  size: { large: string };
}

async function makeWorld(name: string): Promise<World> {
  const user = await db.user.create({ data: { email: `${name}-owner-${stamp}@it.test`, name: `${name} owner`, passwordHash: "x" } });
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const token = `tok_${stamp}_${name}`.padEnd(24, "x");
  const branch = await db.branch.create({
    data: { businessId: biz.id, name: "Main", latitude: 27.71, longitude: 85.32, onlineEnabled: true, onlineToken: token, onlineMinOrder: 20_000 },
  });
  const branch2 = await db.branch.create({ data: { businessId: biz.id, name: "Second" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Buff Momo", price: 25_000 } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Tea", price: 8_000 } });
  const thali = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Thali", price: 40_000 } });
  const base = { businessId: biz.id, userId: user.id, role: "OWNER" as const };
  const owner: TenantContext = { ...base, branchId: branch.id, branchIds: [branch.id, branch2.id] };
  const g = await createGroup(owner, { name: "Size", required: true, multiple: false });
  const large = await createAddOn(owner, g.id, { name: "Large", price: 5_000 });
  await setGroupItems(owner, g.id, [thali.id]);
  return {
    owner,
    other: { ...base, branchId: branch2.id, branchIds: [branch2.id, branch.id] },
    kitchen: { ...owner, role: "KITCHEN" },
    businessId: biz.id,
    branchId: branch.id,
    otherBranchId: branch2.id,
    token,
    momo: momo.id,
    tea: tea.id,
    thali: thali.id,
    size: { large: large.id },
  };
}

let w: World;
const order = (over: Partial<OnlineOrderInput> = {}): OnlineOrderInput => ({
  idempotencyKey: key(),
  type: "TAKEAWAY",
  name: "Sita Rai",
  phone: phone(),
  items: [{ menuItemId: w.momo, quantity: 1 }],
  ...over,
});

beforeAll(async () => {
  w = await makeWorld("itest-online");
});

beforeEach(async () => {
  // Every test starts with nothing waiting and with the branch's settings back to the defaults.
  await db.onlineOrder.deleteMany({ where: { businessId: w.businessId } });
  await db.branch.update({ where: { businessId_id: { businessId: w.businessId, id: w.branchId } }, data: { onlineEnabled: true, onlinePickup: true, onlineDelivery: true, onlineMinOrder: 20_000, onlinePrepMinutes: 20, onlineNotice: null, onlineToken: w.token } });
  await db.menuItem.updateMany({ where: { businessId: w.businessId }, data: { available: true } });
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.onlineOrder.deleteMany({ where: { businessId: id } });
    await db.deliveryPlace.deleteMany({ where: { businessId: id } });
    await db.orderItemAddOn.deleteMany({ where: { businessId: id } });
    await db.orderItem.deleteMany({ where: { businessId: id } });
    await db.order.deleteMany({ where: { businessId: id } });
    await db.customer.deleteMany({ where: { businessId: id } });
    await db.deliveryBand.deleteMany({ where: { businessId: id } });
    await db.deliveryZone.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

describe("the public branch and its menu", () => {
  it("is found by its secret token only", async () => {
    expect(await lookupBranch(w.token)).toMatchObject({ businessName: "itest-online", branchName: "Main", enabled: true, pickup: true, delivery: true, minOrder: 20_000 });
    expect(await lookupBranch("not-a-token")).toBeNull();
    expect(await lookupBranch("x".repeat(30))).toBeNull();
    expect(await lookupBranch(w.branchId)).toBeNull(); // the branch id is not a credential
  });

  it("shows the dishes that can be ordered here, at this branch's price, and hides the rest", async () => {
    await db.menuItem.update({ where: { id: w.tea }, data: { available: false } });
    const menu = await getOnlineMenu({ businessId: w.businessId, branchId: w.branchId });
    const items = menu.flatMap((c) => c.items);
    expect(items.map((i) => i.name).sort()).toEqual(["Buff Momo", "Thali"]);
    expect(items.find((i) => i.name === "Thali")!.groups[0]).toMatchObject({ name: "Size", required: true });
    await db.branchMenuItem.upsert({ where: { branchId_menuItemId: { branchId: w.branchId, menuItemId: w.momo } }, create: { businessId: w.businessId, branchId: w.branchId, menuItemId: w.momo, price: 30_000, available: true }, update: { price: 30_000, available: true } });
    const again = (await getOnlineMenu({ businessId: w.businessId, branchId: w.branchId })).flatMap((c) => c.items);
    expect(again.find((i) => i.name === "Buff Momo")!.price).toBe(30_000);
    await db.branchMenuItem.deleteMany({ where: { businessId: w.businessId } });
  });
});

describe("sending an order", () => {
  it("makes a waiting request priced by the server, with the phone normalised", async () => {
    const o = await submitOnlineOrder(w.token, order({ phone: "98-1234 5670", items: [{ menuItemId: w.momo, quantity: 2 }, { menuItemId: w.tea, quantity: 1 }] }));
    expect(o).toMatchObject({ status: "PENDING", subtotal: 58_000, deliveryFee: 0 });
    const row = await db.onlineOrder.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
    expect(row.customerPhone).toBe("+9779812345670");
    expect(row.items.map((i) => [i.name, i.unitPrice, i.quantity])).toEqual(expect.arrayContaining([["Buff Momo", 25_000, 2], ["Tea", 8_000, 1]]));
    expect(await onlineInboxCount(w.owner)).toBe(1);
    expect(await db.customer.count({ where: { businessId: w.businessId, phone: "+9779812345670" } })).toBe(0); // no customer until staff accept
  });

  it("the same key twice makes one request; the same key from another phone is refused", async () => {
    const input = order();
    const a = await submitOnlineOrder(w.token, input);
    const b = await submitOnlineOrder(w.token, input);
    expect(b.id).toBe(a.id);
    expect(await db.onlineOrder.count({ where: { businessId: w.businessId } })).toBe(1);
    await expect(submitOnlineOrder(w.token, { ...input, phone: phone() })).rejects.toThrow(/went wrong/);
  });

  it("two identical taps at the same moment make one request", async () => {
    const input = order();
    const both = await Promise.all([submitOnlineOrder(w.token, input), submitOnlineOrder(w.token, input)]);
    expect(both[0].id).toBe(both[1].id);
    expect(await db.onlineOrder.count({ where: { businessId: w.businessId } })).toBe(1);
  });

  it("refuses bad input and says why", async () => {
    await expect(submitOnlineOrder(w.token, order({ items: [] }))).rejects.toThrow(/cart is empty/);
    await expect(submitOnlineOrder(w.token, order({ items: [{ menuItemId: w.momo, quantity: 0 }] }))).rejects.toThrow(/between 1 and 20/);
    await expect(submitOnlineOrder(w.token, order({ items: [{ menuItemId: w.momo, quantity: 21 }] }))).rejects.toThrow(/between 1 and 20/);
    await expect(submitOnlineOrder(w.token, order({ phone: "12345" }))).rejects.toThrow(/valid phone/);
    await expect(submitOnlineOrder(w.token, order({ name: " " }))).rejects.toThrow(/your name/);
    await expect(submitOnlineOrder(w.token, order({ idempotencyKey: "short" }))).rejects.toThrow(/went wrong/);
    await expect(submitOnlineOrder(w.token, order({ items: [{ menuItemId: "nope", quantity: 1 }] }))).rejects.toThrow(/no longer available/);
    await expect(submitOnlineOrder("x".repeat(30), order())).rejects.toThrow(/not valid any more/);
    expect(await db.onlineOrder.count({ where: { businessId: w.businessId } })).toBe(0);
  });

  it("enforces the minimum order, and the switches for ordering, pickup and delivery", async () => {
    await expect(submitOnlineOrder(w.token, order({ items: [{ menuItemId: w.tea, quantity: 1 }] }))).rejects.toThrow(/minimum order is Rs 200/);
    await db.branch.update({ where: { businessId_id: { businessId: w.businessId, id: w.branchId } }, data: { onlinePickup: false } });
    await expect(submitOnlineOrder(w.token, order())).rejects.toThrow(/Pickup is not available/);
    await db.branch.update({ where: { businessId_id: { businessId: w.businessId, id: w.branchId } }, data: { onlinePickup: true, onlineEnabled: false } });
    await expect(submitOnlineOrder(w.token, order())).rejects.toThrow(/not available right now/);
  });

  it("a dish's required choice must be made, and its price comes from the server", async () => {
    await expect(submitOnlineOrder(w.token, order({ items: [{ menuItemId: w.thali, quantity: 1 }] }))).rejects.toThrow();
    const o = await submitOnlineOrder(w.token, order({ items: [{ menuItemId: w.thali, quantity: 1, addOnIds: [w.size.large] }] }));
    expect(o.subtotal).toBe(45_000);
    await expect(submitOnlineOrder(w.token, order({ items: [{ menuItemId: w.momo, quantity: 1, addOnIds: [w.size.large] }] }))).rejects.toThrow(); // a choice the dish does not offer
  });

  it("limits what one phone and one branch may have waiting", async () => {
    const mine = phone();
    await submitOnlineOrder(w.token, order({ phone: mine }));
    await submitOnlineOrder(w.token, order({ phone: mine }));
    await expect(submitOnlineOrder(w.token, order({ phone: mine }))).rejects.toThrow(/already have an order waiting/);
    // The branch cap: fill the branch with waiting orders from other phones.
    await db.onlineOrder.deleteMany({ where: { businessId: w.businessId } });
    await db.onlineOrder.createMany({
      data: Array.from({ length: 40 }, (_, i) => ({ businessId: w.businessId, branchId: w.branchId, type: "TAKEAWAY" as const, customerName: "x", customerPhone: `+97798000${String(i).padStart(5, "0")}`, subtotal: 1, idempotencyKey: `fill-${stamp}-${i}`, trackingToken: `trk_${stamp}_${i}`.padEnd(24, "z") })),
    });
    await expect(submitOnlineOrder(w.token, order())).rejects.toThrow(/lot of orders waiting/);
  });
});

describe("delivery", () => {
  beforeEach(async () => {
    await db.deliveryBand.deleteMany({ where: { businessId: w.businessId } });
    await db.deliveryZone.deleteMany({ where: { businessId: w.businessId } });
  });

  it("needs an address", async () => {
    await expect(submitOnlineOrder(w.token, order({ type: "DELIVERY" }))).rejects.toThrow(/delivery address/);
  });

  it("with delivery areas: the customer must choose one, and its fee is added", async () => {
    const zone = await createZone(w.owner, { name: "Lazimpat", fee: 7_000 });
    expect((await lookupBranch(w.token))!.zones).toEqual([{ id: zone.id, name: "Lazimpat", fee: 7_000 }]);
    await expect(submitOnlineOrder(w.token, order({ type: "DELIVERY", address: "House 12, Lazimpat" }))).rejects.toThrow(/delivery area/);
    const o = await submitOnlineOrder(w.token, order({ type: "DELIVERY", address: "House 12, Lazimpat", zoneId: zone.id }));
    expect(o.deliveryFee).toBe(7_000);
    const row = await db.onlineOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(row).toMatchObject({ type: "DELIVERY", address: "House 12, Lazimpat", deliveryZoneName: "Lazimpat", deliveryFee: 7_000 });
    expect(await quoteDelivery(w.token, { address: "House 12, Lazimpat", zoneId: zone.id })).toEqual({ fee: 7_000, label: "Lazimpat" });
  });

  it("with distance bands: the fee comes from the location, and an address too far is refused", async () => {
    await createBand(w.owner, { upToKm: 2, fee: 5_000 });
    await createBand(w.owner, { upToKm: 6, fee: 12_000 });
    const near = await quoteDelivery(w.token, { address: "Near the stupa", location: "27.7172, 85.3240" });
    expect(near).toMatchObject({ fee: 5_000 });
    const mid = await submitOnlineOrder(w.token, order({ type: "DELIVERY", address: "Somewhere further", location: "27.7400, 85.3400" }));
    expect(mid.deliveryFee).toBe(12_000);
    await expect(submitOnlineOrder(w.token, order({ type: "DELIVERY", address: "Far away", location: "28.2000, 85.0000" }))).rejects.toThrow(/outside the delivery range/);
    await expect(quoteDelivery(w.token, { address: "No location given here" })).rejects.toThrow(/paste your location|find that address/i);
  });

  it("a delivery switched off for the branch is refused", async () => {
    await db.branch.update({ where: { businessId_id: { businessId: w.businessId, id: w.branchId } }, data: { onlineDelivery: false } });
    await expect(submitOnlineOrder(w.token, order({ type: "DELIVERY", address: "House 12, Lazimpat" }))).rejects.toThrow(/Delivery is not available/);
  });
});

describe("the customer follows and cancels", () => {
  it("sees the waiting state, an estimate with the charges and the fee, and the time to expect", async () => {
    const o = await submitOnlineOrder(w.token, order({ items: [{ menuItemId: w.momo, quantity: 2 }] }));
    const s = (await getOnlineStatus(w.token, o.trackingToken))!;
    expect(s).toMatchObject({ status: "PENDING", title: "Waiting for the restaurant", canCancel: true, subtotal: 50_000, type: "TAKEAWAY" });
    expect(s.total).toBeGreaterThan(50_000); // service charge and VAT are added
    expect(s.prep).toMatch(/pickup in about 20 minutes/);
    expect(s.items).toEqual([expect.objectContaining({ name: "Buff Momo", quantity: 2 })]);
  });

  it("only the right token and the right link show an order", async () => {
    const o = await submitOnlineOrder(w.token, order());
    expect(await getOnlineStatus(w.token, "y".repeat(30))).toBeNull();
    expect(await getOnlineStatus("x".repeat(30), o.trackingToken)).toBeNull();
    // Another branch's link does not show this branch's order.
    await db.branch.update({ where: { businessId_id: { businessId: w.businessId, id: w.otherBranchId } }, data: { onlineToken: "othertoken".padEnd(24, "o") } });
    expect(await getOnlineStatus("othertoken".padEnd(24, "o"), o.trackingToken)).toBeNull();
  });

  it("can cancel while it is waiting, but not after the restaurant accepted", async () => {
    const o = await submitOnlineOrder(w.token, order());
    await cancelOnlineOrder(w.token, o.trackingToken);
    expect((await getOnlineStatus(w.token, o.trackingToken))!.status).toBe("CANCELLED");
    await expect(acceptOnlineOrder(w.owner, o.id)).rejects.toThrow(/already handled/); // a cancelled order cannot be accepted
    const o2 = await submitOnlineOrder(w.token, order());
    await acceptOnlineOrder(w.owner, o2.id);
    await expect(cancelOnlineOrder(w.token, o2.trackingToken)).rejects.toThrow(/can no longer be cancelled/);
  });
});

describe("staff accept or reject", () => {
  it("accepting makes a real takeaway order with the items, an unconfirmed customer and a note", async () => {
    const input = order({ note: "No onion please", items: [{ menuItemId: w.momo, quantity: 2 }, { menuItemId: w.thali, quantity: 1, addOnIds: [w.size.large] }] });
    const o = await submitOnlineOrder(w.token, input);
    expect((await getOnlineInbox(w.owner)).map((x) => x.id)).toEqual([o.id]);
    const done = await acceptOnlineOrder(w.owner, o.id);
    const real = await db.order.findUniqueOrThrow({ where: { id: done.orderId }, include: { items: { include: { addOns: true } }, customer: true } });
    expect(real).toMatchObject({ type: "TAKEAWAY", status: "OPEN", customerConfirmed: false, note: "Online order: No onion please", idempotencyKey: `online:${o.id}`, deliveryFee: 0 });
    expect(real.customer).toMatchObject({ phone: expect.stringMatching(/^\+977/), name: "Sita Rai" });
    expect(real.items.map((i) => [i.name, i.unitPrice, i.quantity]).sort()).toEqual([["Buff Momo", 25_000, 2], ["Thali", 45_000, 1]].sort());
    expect(real.items.find((i) => i.name === "Thali")!.addOns.map((a) => a.name)).toEqual(["Large"]);
    expect(await db.onlineOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: "ACCEPTED", orderId: done.orderId });
    expect(await onlineInboxCount(w.owner)).toBe(0);
  });

  it("accepting a delivery makes a delivery order with the fee, address and tracking links", async () => {
    const zone = await createZone(w.owner, { name: "Baneshwor", fee: 9_000 });
    const o = await submitOnlineOrder(w.token, order({ type: "DELIVERY", address: "Near the temple, Baneshwor", zoneId: zone.id, location: "27.7000, 85.3300" }));
    const done = await acceptOnlineOrder(w.owner, o.id);
    const real = await db.order.findUniqueOrThrow({ where: { id: done.orderId } });
    expect(real).toMatchObject({ type: "DELIVERY", deliveryStatus: "PREPARING", deliveryFee: 9_000, deliveryZoneName: "Baneshwor", deliveryAddress: "Near the temple, Baneshwor", deliveryName: "Sita Rai" });
    expect(real.trackingToken).toBeTruthy();
    expect(real.riderToken).toBeTruthy();
    expect(real.destLat).toBeCloseTo(27.7);
    const s = (await getOnlineStatus(w.token, o.trackingToken))!;
    expect(s.status).toBe("ACCEPTED");
    expect(s.progress).toMatchObject({ trackUrlToken: real.trackingToken });
    await db.deliveryZone.deleteMany({ where: { businessId: w.businessId } });
  });

  it("an existing customer is reused, and a blank name is filled but never replaced", async () => {
    const p = phone();
    const first = await submitOnlineOrder(w.token, order({ phone: p, name: "First Name" }));
    await acceptOnlineOrder(w.owner, first.id);
    const second = await submitOnlineOrder(w.token, order({ phone: p, name: "Other Name" }));
    await acceptOnlineOrder(w.owner, second.id);
    const customers = await db.customer.findMany({ where: { businessId: w.businessId, phone: { contains: p.slice(-8) } } });
    expect(customers).toHaveLength(1);
    expect(customers[0]!.name).toBe("First Name");
  });

  it("two staff accepting at once make one order", async () => {
    const o = await submitOnlineOrder(w.token, order());
    const results = await Promise.allSettled([acceptOnlineOrder(w.owner, o.id), acceptOnlineOrder(w.owner, o.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.order.count({ where: { businessId: w.businessId, idempotencyKey: `online:${o.id}` } })).toBe(1);
  });

  it("a dish that ran out since the customer ordered stops the accept, and the request stays waiting", async () => {
    const o = await submitOnlineOrder(w.token, order({ items: [{ menuItemId: w.momo, quantity: 1 }, { menuItemId: w.tea, quantity: 2 }] }));
    await db.menuItem.update({ where: { id: w.tea }, data: { available: false } });
    await expect(acceptOnlineOrder(w.owner, o.id)).rejects.toThrow(/No longer available: Tea/);
    expect(await db.onlineOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: "PENDING", orderId: null });
    expect(await db.order.count({ where: { businessId: w.businessId, idempotencyKey: `online:${o.id}` } })).toBe(0);
  });

  it("rejecting records the reason, which the customer sees", async () => {
    const o = await submitOnlineOrder(w.token, order());
    await rejectOnlineOrder(w.owner, o.id, "We are closing early today");
    const s = (await getOnlineStatus(w.token, o.trackingToken))!;
    expect(s).toMatchObject({ status: "REJECTED", detail: "We are closing early today", canCancel: false });
    await expect(rejectOnlineOrder(w.owner, o.id)).rejects.toThrow(/already handled/);
    const o2 = await submitOnlineOrder(w.token, order());
    await rejectOnlineOrder(w.owner, o2.id);
    expect((await getOnlineStatus(w.token, o2.trackingToken))!.detail).toMatch(/cannot prepare this right now/);
  });

  it("staff of another branch cannot handle this branch's orders, and people without the permission cannot either", async () => {
    const o = await submitOnlineOrder(w.token, order());
    await expect(acceptOnlineOrder(w.other, o.id)).rejects.toThrow(/already handled/);
    await expect(rejectOnlineOrder(w.other, o.id)).rejects.toThrow(/already handled/);
    await expect(acceptOnlineOrder(w.kitchen, o.id)).rejects.toThrow(/permission/);
    await expect(getOnlineInbox(w.kitchen)).rejects.toThrow(/permission/);
    expect(await onlineInboxCount(w.kitchen)).toBe(0);
    expect(await onlineInboxCount(w.other)).toBe(0);
    expect(await db.onlineOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: "PENDING" });
  });

  it("requests nobody answered expire, and are marked stale in the inbox before that", async () => {
    const o = await submitOnlineOrder(w.token, order());
    await db.onlineOrder.update({ where: { id: o.id }, data: { createdAt: new Date(Date.now() - 70 * 60_000) } });
    expect((await getOnlineInbox(w.owner))[0]!.stale).toBe(true);
    expect(await expireStaleOnlineOrders()).toBeGreaterThanOrEqual(1);
    expect((await getOnlineStatus(w.token, o.trackingToken))!.status).toBe("EXPIRED");
    expect(await onlineInboxCount(w.owner)).toBe(0);
  });
});

describe("settings", () => {
  const settings = { enabled: true, pickup: true, delivery: false, minOrder: 15_000, prepMinutes: 30, notice: "Closed on Tuesdays" };

  it("only the owner changes them; the link is made once and kept", async () => {
    await expect(saveOnlineSettings(w.kitchen, settings)).rejects.toThrow(/Only the owner/);
    await db.branch.update({ where: { businessId_id: { businessId: w.businessId, id: w.otherBranchId } }, data: { onlineToken: null, onlineEnabled: false } });
    await saveOnlineSettings(w.other, settings);
    const first = await getOnlineSettings(w.other);
    expect(first).toMatchObject({ enabled: true, pickup: true, delivery: false, minOrder: 15_000, prepMinutes: 30, notice: "Closed on Tuesdays" });
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    await saveOnlineSettings(w.other, { ...settings, notice: "" });
    expect((await getOnlineSettings(w.other)).token).toBe(first.token);
  });

  it("refuses silly values", async () => {
    await expect(saveOnlineSettings(w.owner, { ...settings, minOrder: -1 })).rejects.toThrow(/minimum order/);
    await expect(saveOnlineSettings(w.owner, { ...settings, prepMinutes: 1 })).rejects.toThrow(/Preparation time/);
    await expect(saveOnlineSettings(w.owner, { ...settings, pickup: false, delivery: false })).rejects.toThrow(/pickup or delivery/);
  });

  it("a new link kills the old one at once", async () => {
    await rotateOnlineLink(w.owner);
    expect(await lookupBranch(w.token)).toBeNull();
    const fresh = (await getOnlineSettings(w.owner)).token!;
    expect(await lookupBranch(fresh)).toMatchObject({ branchName: "Main" });
  });
});
