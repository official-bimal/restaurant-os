import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { addDays } from "@/lib/business-day";
import { nowIn, seatReservation, todaysBookings } from "./service";

const stamp = Date.now();
let businessId: string;
let branchId: string;
let owner: TenantContext;
let waiter: TenantContext;
let kitchen: TenantContext;
let tableA: string;
let tableB: string;
let timezone: string;
let n = 0;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `seat-${stamp}@it.test`, name: "Seat", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-seat-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  timezone = biz.timezone;
  const branch = await db.branch.create({ data: { businessId, name: "Main" } });
  branchId = branch.id;
  const area = await db.area.create({ data: { businessId, branchId, name: "Hall" } });
  tableA = (await db.diningTable.create({ data: { businessId, branchId, areaId: area.id, label: "T1", capacity: 4 } })).id;
  tableB = (await db.diningTable.create({ data: { businessId, branchId, areaId: area.id, label: "T2", capacity: 4 } })).id;
  const base = { userId: user.id, businessId, branchId, branchIds: [branchId] };
  owner = { ...base, role: "OWNER" };
  waiter = { ...base, role: "WAITER" };
  kitchen = { ...base, role: "KITCHEN" };
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.reservation.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

const booking = (over: { name: string; date?: string; time?: string; tableId?: string | null; status?: "CONFIRMED" | "REQUESTED" }) =>
  db.reservation.create({
    data: {
      businessId,
      branchId,
      name: over.name,
      phone: "+9779800000000",
      partySize: 2,
      date: over.date ?? nowIn(timezone).today,
      time: over.time ?? "12:00",
      tableId: over.tableId === undefined ? tableA : over.tableId,
      status: over.status ?? "CONFIRMED",
      token: `seat${stamp}x${++n}`.padEnd(20, "x"),
    },
  });

describe("seating a booking", () => {
  it("starts the table's order and marks the booking seated, once", async () => {
    const r = await booking({ name: "Seat1" });
    const seated = await seatReservation(waiter, r.id);
    expect(seated.tableLabel).toBe("T1");
    const row = await db.reservation.findFirstOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: "SEATED", orderId: seated.orderId, tableId: tableA });
    expect(row.seatedAt).not.toBeNull();
    const order = await db.order.findFirstOrThrow({ where: { id: seated.orderId } });
    expect(order).toMatchObject({ tableId: tableA, type: "DINE_IN", status: "OPEN" });
    // Pressing the button twice gives the same order, not a second one.
    expect((await seatReservation(waiter, r.id)).orderId).toBe(seated.orderId);
    expect(await db.order.count({ where: { businessId, tableId: tableA } })).toBe(1);
    await db.order.update({ where: { id: seated.orderId }, data: { status: "CANCELLED" } });
  });

  it("seats at another table when the guests ask, and refuses a table that has an open bill", async () => {
    const r = await booking({ name: "Seat2" });
    const first = await booking({ name: "Seat3", tableId: tableA, time: "13:00" });
    const busy = await seatReservation(owner, first.id);
    await expect(seatReservation(owner, r.id)).rejects.toThrow(/already has an open order/);
    expect((await db.reservation.findFirstOrThrow({ where: { id: r.id } })).status).toBe("CONFIRMED");
    const moved = await seatReservation(owner, r.id, tableB);
    expect(moved.tableLabel).toBe("T2");
    expect((await db.reservation.findFirstOrThrow({ where: { id: r.id } })).tableId).toBe(tableB);
    await db.order.updateMany({ where: { id: { in: [busy.orderId, moved.orderId] } }, data: { status: "CANCELLED" } });
  });

  it("only seats a confirmed booking, on its own day, at a table", async () => {
    const waiting = await booking({ name: "Seat4", status: "REQUESTED" });
    await expect(seatReservation(owner, waiting.id)).rejects.toThrow(/Confirm the booking first/);
    const later = await booking({ name: "Seat5", date: addDays(nowIn(timezone).today, 9) });
    await expect(seatReservation(owner, later.id)).rejects.toThrow(/on that day/);
    const noTable = await booking({ name: "Seat6", tableId: null });
    await expect(seatReservation(owner, noTable.id)).rejects.toThrow(/Choose a table/);
    await expect(seatReservation(owner, noTable.id, "nope")).rejects.toThrow(/Table not found/);
    await expect(seatReservation(kitchen, noTable.id, tableA)).rejects.toThrow(/permission/);
    await expect(seatReservation(owner, "nope")).rejects.toThrow(/Booking not found/);
  });

  it("tells the floor map which table is held and how soon", async () => {
    const { minute } = nowIn(timezone);
    if (minute > 22 * 60) return; // too close to midnight to place a booking later today
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const soon = await booking({ name: "Soon", tableId: tableB, time: hhmm(minute + 30) });
    const { floor, coming } = await todaysBookings(waiter);
    expect(floor.get(tableB)).toMatchObject({ id: soon.id, state: "soon" });
    expect(coming.some((c) => c.id === soon.id && c.tableLabel === "T2")).toBe(true);
    expect((await todaysBookings(kitchen)).coming).toEqual([]);
    await db.reservation.update({ where: { id: soon.id }, data: { status: "CANCELLED" } });
    expect((await todaysBookings(waiter)).floor.get(tableB)).toBeUndefined();
  });
});
