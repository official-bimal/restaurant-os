import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { addItem, checkout, createOrder, previewBill } from "@/features/orders/server/service";
import { addDisplay, deleteDisplay, follow, getSetting, listDisplays, newLink, removePaymentQr, renameDisplay, saveSetting, screenLogo, screenQr, screenState, setPaymentQr } from "./service";

const stamp = Date.now();
const businessIds: string[] = [];
let n = 0;
const uid = () => `${++n}-${Math.random().toString(36).slice(2, 8)}`;

async function world(name: string) {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, cashier, waiter] = await Promise.all(["owner", "cash", "wait"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  await db.membership.create({ data: { userId: cashier.id, businessId: biz.id, role: "CASHIER" } });
  await db.membership.create({ data: { userId: waiter.id, businessId: biz.id, role: "WAITER" } });
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  const area = await db.area.create({ data: { businessId: biz.id, branchId: branch.id, name: "Main" } });
  const cat = await db.menuCategory.create({ data: { businessId: biz.id, name: "Food" } });
  const momo = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Buff Momo", price: 25_000 } });
  const tea = await db.menuItem.create({ data: { businessId: biz.id, categoryId: cat.id, name: "Masala Tea", price: 8_000 } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, userId: owner.id, role: "OWNER" } as TenantContext,
    cashier: { ...base, userId: cashier.id, role: "CASHIER" } as TenantContext,
    waiter: { ...base, userId: waiter.id, role: "WAITER" } as TenantContext,
    areaId: area.id,
    momo: momo.id,
    tea: tea.id,
  };
}

type W = Awaited<ReturnType<typeof world>>;
let a: W;
let b: W;
const BASE = "http://shop.test";
const png = () => {
  const x = new Uint8Array(100).fill(1);
  x.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return x;
};

async function order(w: W, items: [string, number, string?][] = []) {
  const table = await db.diningTable.create({ data: { businessId: w.owner.businessId, branchId: w.owner.branchId, areaId: w.areaId, label: `T${uid()}` } });
  const o = await createOrder(w.waiter, { type: "DINE_IN", tableId: table.id, idempotencyKey: `k-${uid()}-${stamp}` });
  for (const [menuItemId, quantity, note] of items) await addItem(w.waiter, o.id, { menuItemId, quantity, note });
  return o;
}

beforeAll(async () => {
  a = await world("itest-disp-a");
  b = await world("itest-disp-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.paymentIntent.deleteMany({ where: { businessId: id } });
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

let counter = "";
let tokenA = "";
let tokenB = "";

describe("setting it up", () => {
  it("only people who manage the display change it, and it starts switched off", async () => {
    expect(await getSetting(a.owner.businessId)).toMatchObject({ enabled: false, hasQr: false, thanksSeconds: 12, showNotes: true });
    const input = { enabled: true, welcomeTitle: "Welcome to Nerro", welcomeText: "", thanksText: "Dhanyabad!", thanksSeconds: 10, showNotes: true, showLogo: true, autoQr: false, qrLabel: "Scan to pay with Fonepay" };
    await expect(saveSetting(a.cashier, input)).rejects.toThrow(/permission/);
    await expect(saveSetting(a.waiter, input)).rejects.toThrow(/permission/);
    await expect(saveSetting(a.owner, { ...input, thanksSeconds: 1 })).rejects.toThrow(/3 to 120/);
    await saveSetting(a.owner, input);
    expect(await getSetting(a.owner.businessId)).toMatchObject({ enabled: true, welcomeTitle: "Welcome to Nerro", thanksText: "Dhanyabad!", thanksSeconds: 10 });
    expect((await getSetting(b.owner.businessId)).enabled).toBe(false); // another business is untouched
  });

  it("keeps a payment QR picture, only a real small image, and removes it", async () => {
    await expect(setPaymentQr(a.cashier, png())).rejects.toThrow(/permission/);
    await expect(setPaymentQr(a.owner, new Uint8Array(0))).rejects.toThrow(/Choose/);
    await expect(setPaymentQr(a.owner, new Uint8Array(50).fill(7))).rejects.toThrow(/JPEG/);
    await expect(setPaymentQr(a.owner, new Uint8Array(400_000))).rejects.toThrow(/too big/);
    await setPaymentQr(a.owner, png());
    expect((await getSetting(a.owner.businessId)).hasQr).toBe(true);
  });

  it("makes screens with secret links, per branch, with clean names", async () => {
    await expect(addDisplay(a.cashier, "Counter")).rejects.toThrow(/permission/);
    await expect(addDisplay(a.owner, "  ")).rejects.toThrow(/name/);
    counter = await addDisplay(a.owner, " Counter ");
    await expect(addDisplay(a.owner, "counter")).rejects.toThrow(/already/);
    const list = await listDisplays(a.owner);
    expect(list.map((d) => d.name)).toEqual(["Counter"]);
    tokenA = list[0]!.token;
    expect(tokenA).toMatch(/^cd_[A-Za-z0-9_-]{30,}$/);
    // The till gets the link too (it opens the screen); a waiter gets nothing.
    expect((await listDisplays(a.cashier))[0]!.token).toBe(tokenA);
    await expect(listDisplays(a.waiter)).rejects.toThrow(/permission/);
    expect(await listDisplays(b.owner)).toEqual([]);
    const bId = await addDisplay(b.owner, "Counter");
    tokenB = (await listDisplays(b.owner)).find((d) => d.id === bId)!.token;
    expect(tokenB).not.toBe(tokenA);
    await expect(renameDisplay(b.owner, counter, "Hacked")).rejects.toThrow(/not found/);
    await expect(deleteDisplay(b.owner, counter)).rejects.toThrow(/not found/);
    await expect(newLink(b.owner, counter)).rejects.toThrow(/not found/);
    await renameDisplay(a.owner, counter, "Counter 1");
    expect((await listDisplays(a.owner))[0]!.name).toBe("Counter 1");
  });
});

describe("what the screen shows", () => {
  it("says nothing for a link that is not valid, and serves the QR picture only to a valid link", async () => {
    expect(await screenState("nope", BASE)).toBeNull();
    expect(await screenState("cd_" + "x".repeat(30), BASE)).toBeNull();
    expect(await screenState("cd_short", BASE)).toBeNull();
    expect((await screenQr(tokenA))?.contentType).toBe("image/png");
    expect(await screenQr(tokenB)).toBeNull(); // business B has no QR
    expect(await screenQr("cd_" + "x".repeat(30))).toBeNull();
    expect(await screenLogo(tokenA)).toBeNull();
  });

  it("shows the welcome when idle, and the switched-off note when the business has it off", async () => {
    const idle = await screenState(tokenA, BASE);
    expect(idle).toMatchObject({ kind: "IDLE", title: "Welcome to Nerro", business: "itest-disp-a", lines: [], totals: null });
    expect((await screenState(tokenB, BASE))!.kind).toBe("OFF");
  });

  it("builds the bill as the till builds it, including the options the cashier chose", async () => {
    const o = await order(a, [[a.momo, 2, "extra spicy"], [a.tea, 1]]);
    await expect(follow(a.waiter, { displayId: counter, orderId: o.id })).rejects.toThrow(/permission/);
    await expect(follow(b.owner, { displayId: counter, orderId: o.id })).rejects.toThrow(/not found/); // another business's screen
    await expect(follow(a.cashier, { displayId: counter, orderId: (await order(b)).id })).rejects.toThrow(/Order not found/);
    await follow(a.cashier, { displayId: counter, orderId: o.id, options: { discountPercent: 10 } });
    const s = (await screenState(tokenA, BASE))!;
    expect(s.kind).toBe("BILL");
    expect(s.lines.map((l) => [l.qty, l.name, l.total, l.note])).toEqual([[2, "Buff Momo", 50_000, "extra spicy"], [1, "Masala Tea", 8_000, null]]);
    const plain = await previewBill(a.owner, o.id, { kind: "none" });
    const tenOff = await previewBill(a.owner, o.id, { kind: "percent", bps: 1000 });
    expect(s.totals!.grandTotal).toBe(tenOff.grandTotal);
    expect(s.totals!.grandTotal).toBeLessThan(plain.grandTotal);
    expect(s.totals!.discount).toBe(tenOff.discount);
    expect(s.where).toMatch(/^Table /);
    expect(s.qr).toBeNull();
    await follow(a.cashier, { displayId: counter, orderId: o.id, options: { discountPercent: 999, redeemPoints: -5 } }); // cleaned, not trusted
    expect((await screenState(tokenA, BASE))!.totals!.discount).toBe((await previewBill(a.owner, o.id, { kind: "percent", bps: 10_000 })).discount);
    await follow(a.cashier, { displayId: counter, orderId: o.id });
    expect((await screenState(tokenA, BASE))!.totals!.grandTotal).toBe(plain.grandTotal);
  });

  it("hides item notes when the owner chose so, and drops cancelled items", async () => {
    const o = await order(a, [[a.momo, 1, "no onion"], [a.tea, 1]]);
    await follow(a.cashier, { displayId: counter, orderId: o.id });
    const input = { enabled: true, welcomeTitle: "Welcome to Nerro", welcomeText: "", thanksText: "Dhanyabad!", thanksSeconds: 10, showNotes: false, showLogo: true, autoQr: false, qrLabel: "Scan to pay with Fonepay" };
    await saveSetting(a.owner, input);
    expect((await screenState(tokenA, BASE))!.lines[0]!.note).toBeNull();
    await db.orderItem.updateMany({ where: { orderId: o.id, name: "Masala Tea" }, data: { status: "CANCELLED" } });
    expect((await screenState(tokenA, BASE))!.lines.map((l) => l.name)).toEqual(["Buff Momo"]);
    await saveSetting(a.owner, { ...input, showNotes: true });
  });

  it("goes back to the welcome when the till stops checking in", async () => {
    const o = await order(a, [[a.tea, 1]]);
    await follow(a.cashier, { displayId: counter, orderId: o.id });
    expect((await screenState(tokenA, BASE))!.kind).toBe("BILL");
    expect((await screenState(tokenA, BASE, new Date(Date.now() + 90_000)))!.kind).toBe("IDLE");
    await follow(a.cashier, { displayId: counter, orderId: null });
    expect((await screenState(tokenA, BASE))!.kind).toBe("IDLE");
    expect((await db.customerDisplay.findUniqueOrThrow({ where: { id: counter } })).orderId).toBeNull();
  });

  it("shows the fixed payment QR when asked for, or always when the owner chose", async () => {
    const o = await order(a, [[a.tea, 1]]);
    await follow(a.cashier, { displayId: counter, orderId: o.id });
    expect((await screenState(tokenA, BASE))!.qr).toBeNull();
    await follow(a.cashier, { displayId: counter, orderId: o.id, showQr: true });
    const s = (await screenState(tokenA, BASE))!;
    expect(s.qr).toMatchObject({ kind: "static", label: "Scan to pay with Fonepay" });
    expect(s.qr!.src).toContain(`/api/display/${tokenA}/qr`);
    await follow(a.cashier, { displayId: counter, orderId: o.id, showQr: false });
    await saveSetting(a.owner, { enabled: true, welcomeTitle: "", welcomeText: "", thanksText: "", thanksSeconds: 10, showNotes: true, showLogo: true, autoQr: true, qrLabel: "" });
    expect((await screenState(tokenA, BASE))!.qr).toMatchObject({ kind: "static", label: "Scan to pay" });
    await saveSetting(a.owner, { enabled: true, welcomeTitle: "Welcome to Nerro", welcomeText: "", thanksText: "Dhanyabad!", thanksSeconds: 10, showNotes: true, showLogo: true, autoQr: false, qrLabel: "" });
  });

  it("shows a started eSewa or Khalti payment's own QR with its amount, then payment received", async () => {
    const o = await order(a, [[a.momo, 1]]);
    await follow(a.cashier, { displayId: counter, orderId: o.id, showQr: true });
    const t = await previewBill(a.owner, o.id, { kind: "none" });
    const intent = await db.paymentIntent.create({
      data: { businessId: a.owner.businessId, branchId: a.owner.branchId, orderId: o.id, provider: "ESEWA", amount: t.grandTotal, token: `tok${uid()}`, uuid: `u-${uid()}`, status: "CREATED", expiresAt: new Date(Date.now() + 600_000) },
    });
    const pay = (await screenState(tokenA, BASE))!;
    expect(pay.kind).toBe("PAY");
    expect(pay.qr).toMatchObject({ kind: "intent", label: "eSewa" });
    expect(pay.qr!.svg).toContain("<svg");
    expect(pay.payAmount).toBe(t.grandTotal);
    await db.paymentIntent.update({ where: { id: intent.id }, data: { status: "PAID", paidAt: new Date() } });
    const paid = (await screenState(tokenA, BASE))!;
    expect(paid.kind).toBe("PAID");
    expect(paid.paidAmount).toBe(t.grandTotal);
    // An expired or cancelled attempt does not take over the screen.
    await db.paymentIntent.update({ where: { id: intent.id }, data: { status: "CANCELLED" } });
    expect((await screenState(tokenA, BASE))!.kind).toBe("BILL");
  });

  it("thanks the customer after the bill is paid, even once the till has left the page, then goes idle", async () => {
    const o = await order(a, [[a.tea, 2]]);
    await follow(a.cashier, { displayId: counter, orderId: o.id });
    const t = await previewBill(a.owner, o.id, { kind: "none" });
    const inv = await checkout(a.owner, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
    await follow(a.cashier, { displayId: counter, orderId: null }); // the cashier moves on at once
    const thanks = (await screenState(tokenA, BASE))!;
    expect(thanks.kind).toBe("THANKS");
    expect(thanks.title).toBe("Dhanyabad!");
    expect(thanks.paidAmount).toBe(inv.grandTotal);
    expect((await screenState(tokenA, BASE, new Date(Date.now() + 15_000)))!.kind).toBe("IDLE");
  });

  it("stops working when the link is replaced, and never shows another business's orders", async () => {
    const o = await order(a, [[a.tea, 1]]);
    await follow(a.cashier, { displayId: counter, orderId: o.id });
    await newLink(a.owner, counter);
    expect(await screenState(tokenA, BASE)).toBeNull();
    const fresh = (await listDisplays(a.owner))[0]!;
    expect(fresh.token).not.toBe(tokenA);
    expect(fresh.orderId).toBeNull();
    // Business B's screen shows B's idle state only: A's orders are not reachable from it.
    await saveSetting(b.owner, { enabled: true, welcomeTitle: "", welcomeText: "", thanksText: "", thanksSeconds: 12, showNotes: true, showLogo: true, autoQr: false, qrLabel: "" });
    const bs = (await screenState(tokenB, BASE))!;
    expect(bs).toMatchObject({ kind: "IDLE", business: "itest-disp-b", lines: [] });
    await deleteDisplay(a.owner, counter);
    expect(await listDisplays(a.owner)).toEqual([]);
    await removePaymentQr(a.owner);
    expect((await getSetting(a.owner.businessId)).hasQr).toBe(false);
  });
});
