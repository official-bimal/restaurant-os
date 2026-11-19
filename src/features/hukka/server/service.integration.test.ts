import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { createOrder, addItem, previewBill, checkout } from "@/features/orders/server/service";
import { addCoil, finishHukka, getHukkaBoard, hukkaAlertCount, startHukka } from "./service";

const stamp = Date.now();
let n = 0;
const key = () => `hk-${stamp}-${++n}`;
let owner: TenantContext;
let kitchen: TenantContext;
let businessId: string;
let mint: string;
let coil: string;
let coffee: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `hk-${stamp}@it.test`, name: "HK", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-hk-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  const hukka = await db.menuCategory.create({ data: { businessId, name: "Hukka (Shisha)" } });
  const drinks = await db.menuCategory.create({ data: { businessId, name: "Drinks" } });
  mint = (await db.menuItem.create({ data: { businessId, categoryId: hukka.id, name: "Hukka Mint", price: 50_000 } })).id;
  coil = (await db.menuItem.create({ data: { businessId, categoryId: hukka.id, name: "Extra Coil", price: 5_000 } })).id;
  coffee = (await db.menuItem.create({ data: { businessId, categoryId: drinks.id, name: "Espresso", price: 13_000 } })).id;
  const base = { userId: user.id, businessId, branchId: branch.id, branchIds: [branch.id] };
  owner = { ...base, role: "OWNER" };
  kitchen = { ...base, role: "KITCHEN" };
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.hukkaSession.deleteMany({ where: { businessId } });
  await db.printJob.deleteMany({ where: { businessId } });
  await db.payment.deleteMany({ where: { businessId } });
  await db.invoice.deleteMany({ where: { businessId } });
  await db.orderItem.deleteMany({ where: { businessId } });
  await db.order.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

async function openOrder() {
  const o = await createOrder(owner, { type: "TAKEAWAY", idempotencyKey: key() });
  await addItem(owner, o.id, { menuItemId: mint, quantity: 1 });
  await addItem(owner, o.id, { menuItemId: coffee, quantity: 1 });
  return o;
}

describe("hukka timer", () => {
  it("lists only hukkas (not coffee or coils) as waiting, then times one, counts coils and bills them", async () => {
    const o = await openOrder();
    const board = await getHukkaBoard(owner);
    const waiting = board.waiting.filter((w) => w.orderId === o.id);
    expect(waiting.map((w) => w.name)).toEqual(["Hukka Mint"]);

    const s = await startHukka(owner, waiting[0]!.orderItemId, 45);
    expect(s.alertMinutes).toBe(45);
    await expect(startHukka(owner, waiting[0]!.orderItemId)).rejects.toThrow(/already/);
    expect((await getHukkaBoard(owner)).waiting.some((w) => w.orderId === o.id)).toBe(false);

    await addCoil(owner, s.id);
    await addCoil(owner, s.id);
    const row = await db.hukkaSession.findFirstOrThrow({ where: { id: s.id } });
    expect(row.coils).toBe(2);
    const coils = await db.orderItem.findMany({ where: { orderId: o.id, menuItemId: coil } });
    expect(coils.reduce((c, i) => c + i.quantity, 0)).toBe(2);
    // The coil is not itself a hukka to time.
    expect((await getHukkaBoard(owner)).waiting.some((w) => w.orderId === o.id)).toBe(false);

    await finishHukka(owner, s.id);
    await expect(finishHukka(owner, s.id)).rejects.toThrow(/not running/);
    await expect(addCoil(owner, s.id)).rejects.toThrow(/not running/);
  });

  it("refuses to time anything that is not a hukka, and flags one running long", async () => {
    const o = await openOrder();
    const items = await db.orderItem.findMany({ where: { orderId: o.id } });
    const espresso = items.find((i) => i.menuItemId === coffee)!;
    await expect(startHukka(owner, espresso.id)).rejects.toThrow(/Only a hukka/);
    await expect(startHukka(owner, items[0]!.id, 5)).rejects.toThrow(/between 15 and 240/);
    const s = await startHukka(owner, items.find((i) => i.menuItemId === mint)!.id, 30);
    expect(await hukkaAlertCount(owner)).toBe(0);
    await db.hukkaSession.update({ where: { id: s.id }, data: { startedAt: new Date(Date.now() - 31 * 60_000) } });
    expect(await hukkaAlertCount(owner)).toBe(1);
  });

  it("ends by itself when the bill is paid, and is for people who handle orders", async () => {
    const o = await openOrder();
    const item = (await db.orderItem.findMany({ where: { orderId: o.id } })).find((i) => i.menuItemId === mint)!;
    const s = await startHukka(owner, item.id);
    const t = await previewBill(owner, o.id, { kind: "none" });
    await checkout(owner, o.id, { discount: { kind: "none" }, payments: [{ method: "CASH", amount: t.grandTotal }] });
    await getHukkaBoard(owner);
    expect((await db.hukkaSession.findFirstOrThrow({ where: { id: s.id } })).endedAt).not.toBeNull();
    await expect(getHukkaBoard(kitchen)).rejects.toThrow(/permission/);
  });
});
