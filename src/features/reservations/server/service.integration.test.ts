import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { addDays, localDate } from "@/lib/business-day";
import {
  cancelOwnReservation,
  createReservation,
  getReservationByToken,
  listReservations,
  lookupReservationBranch,
  reservationsWaitingCount,
  setReservationStatus,
  setReservationsEnabled,
  submitReservationRequest,
} from "./service";

const stamp = Date.now();
let owner: TenantContext;
let waiter: TenantContext;
let kitchen: TenantContext;
let businessId: string;
let branchId: string;
let publicToken: string;
let tableA: string;
let tableB: string;
let tomorrow: string;
let nextWeek: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `rs-${stamp}@it.test`, name: "RS", passwordHash: "x" } });
  const biz = await db.business.create({ data: { name: `itest-rs-${stamp}`, memberships: { create: { userId: user.id, role: "OWNER" } } } });
  businessId = biz.id;
  publicToken = `Tok${stamp}abcdefghijkl`.slice(0, 30);
  const branch = await db.branch.create({ data: { businessId, name: "Main", onlineToken: publicToken } });
  branchId = branch.id;
  const area = await db.area.create({ data: { businessId, branchId, name: "Hall" } });
  tableA = (await db.diningTable.create({ data: { businessId, branchId, areaId: area.id, label: "T1", capacity: 4 } })).id;
  tableB = (await db.diningTable.create({ data: { businessId, branchId, areaId: area.id, label: "T2", capacity: 4 } })).id;
  const base = { userId: user.id, businessId, branchId, branchIds: [branchId] };
  owner = { ...base, role: "OWNER" };
  waiter = { ...base, role: "WAITER" };
  kitchen = { ...base, role: "KITCHEN" };
  const today = localDate(new Date(), biz.timezone);
  tomorrow = addDays(today, 1);
  nextWeek = addDays(today, 7);
});

afterAll(async () => {
  const members = await db.membership.findMany({ where: { businessId } });
  await db.reservation.deleteMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

const ask = (over: Partial<{ name: string; phone: string; partySize: number; date: string; time: string; note: string }> = {}) =>
  submitReservationRequest(publicToken, { name: "Sita Rai", phone: "9841234567", partySize: 4, date: tomorrow, time: "19:00", ...over });

describe("a guest asks for a table", () => {
  it("is refused while requests are off, then works once the owner turns them on", async () => {
    expect((await lookupReservationBranch(publicToken))?.enabled).toBe(false);
    await expect(ask()).rejects.toThrow(/not taking table requests/);
    await expect(setReservationsEnabled(waiter, true)).rejects.toThrow(/owner/);
    await setReservationsEnabled(owner, true);
    const r = await ask();
    const seen = await getReservationByToken(r.token);
    expect(seen).toMatchObject({ partySize: 4, date: tomorrow, time: "19:00", status: "REQUESTED" });
    expect(await reservationsWaitingCount(owner)).toBe(1);
    expect(await getReservationByToken("not-a-real-token-at-all")).toBeNull();
  });

  it("checks the booking and limits how many one phone can hold", async () => {
    await expect(ask({ partySize: 40 })).rejects.toThrow(/call us/);
    await expect(ask({ date: "2020-01-01" })).rejects.toThrow(/passed/);
    await expect(ask({ phone: "abc" })).rejects.toThrow(/phone/);
    await expect(ask({ time: "99:99" })).rejects.toThrow(/time/);
    await ask({ time: "20:00" });
    await ask({ time: "21:00" });
    await expect(ask({ time: "22:00" })).rejects.toThrow(/already have bookings/);
    await expect(submitReservationRequest("x".repeat(20), { name: "A", phone: "9841234567", partySize: 2, date: tomorrow, time: "19:00" })).rejects.toThrow(/not available/);
  });

  it("can take their own request back, but not once it is seated", async () => {
    const r = await ask({ phone: "9851234567" });
    await cancelOwnReservation(r.token);
    expect((await getReservationByToken(r.token))?.status).toBe("CANCELLED");
    await expect(cancelOwnReservation(r.token)).rejects.toThrow(/no longer/);
  });
});

describe("staff handle the bookings", () => {
  it("confirms, with a table, and refuses a table that is already taken at that time", async () => {
    const mine = await createReservation(owner, { name: "Ram", phone: "9861111111", partySize: 2, date: nextWeek, time: "19:00", tableId: tableA });
    expect(mine.status).toBe("CONFIRMED");
    await expect(createReservation(waiter, { name: "Hari", phone: "9862222222", partySize: 2, date: nextWeek, time: "20:00", tableId: tableA })).rejects.toThrow(/already booked/);
    await createReservation(waiter, { name: "Hari", phone: "9862222222", partySize: 2, date: nextWeek, time: "20:30", tableId: tableA }); // 90 minutes apart: fine
    await createReservation(waiter, { name: "Gita", phone: "9863333333", partySize: 2, date: nextWeek, time: "19:00", tableId: tableB });

    const req = await ask({ phone: "9801234567", date: nextWeek, time: "19:15" });
    const row = await db.reservation.findFirstOrThrow({ where: { token: req.token } });
    await expect(setReservationStatus(owner, row.id, "CONFIRMED", { tableId: tableA })).rejects.toThrow(/already booked/);
    const res = await setReservationStatus(owner, row.id, "CONFIRMED", { tableId: tableB }).catch((e) => e);
    expect(res).toBeInstanceOf(Error); // T2 is taken at 19:00 too
    const ok = await setReservationStatus(owner, row.id, "CONFIRMED");
    // No text-message provider is set up in tests: staff are told to message the guest themselves.
    expect(ok.sms).toBe("not-set-up");
    expect((await getReservationByToken(req.token))?.status).toBe("CONFIRMED");
  });

  it("only moves a booking forward", async () => {
    const r = await createReservation(owner, { name: "Mina", phone: "9864444444", partySize: 3, date: nextWeek, time: "12:00" });
    await expect(setReservationStatus(owner, r.id, "CONFIRMED")).rejects.toThrow(/cannot be changed/); // already confirmed
    expect((await setReservationStatus(owner, r.id, "SEATED")).sms).toBe("not-sent");
    await expect(setReservationStatus(owner, r.id, "CANCELLED")).rejects.toThrow(/cannot be changed/);
    const b = await createReservation(owner, { name: "Bina", phone: "9865555555", partySize: 2, date: nextWeek, time: "13:00" });
    await setReservationStatus(owner, b.id, "NO_SHOW");
    expect((await db.reservation.findFirstOrThrow({ where: { id: b.id } })).status).toBe("NO_SHOW");
  });

  it("lists a day for people who handle orders only, and never another branch's bookings", async () => {
    const { rows, tables } = await listReservations(owner, nextWeek);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.every((r) => r.branchId === branchId)).toBe(true);
    expect(tables).toHaveLength(2);
    await expect(listReservations(kitchen, nextWeek)).rejects.toThrow(/permission/);
    await expect(listReservations(owner, "nope")).rejects.toThrow(/valid date/);
  });
});
