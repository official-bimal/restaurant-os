import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { getTrialBalance, syncPostings } from "@/features/accounting/server/service";
import { localDate } from "@/lib/business-day";
import { addRosterShift, copyWeek, createPayout, getRosterWeek, listTips, myShifts, previewPayout, recordTip, removeRosterShift } from "./service";

const stamp = Date.now();
let owner: TenantContext;
let manager: TenantContext;
let cashier: TenantContext;
let businessId: string;
let branchId: string;
let otherBranch: string;
let asha: string;
let bimal: string;
let outsider: string;
let rider: string;
let today: string;
const WEEK = "2026-11-15"; // a Sunday

beforeAll(async () => {
  const mk = (name: string) => db.user.create({ data: { email: `${name}-${stamp}@it.test`, name, passwordHash: "x" } });
  const [o, a, b, c, r] = await Promise.all([mk("Owner"), mk("Asha"), mk("Bimal"), mk("Outsider"), mk("Rider")]);
  asha = a.id;
  bimal = b.id;
  outsider = c.id;
  rider = r.id;
  const biz = await db.business.create({ data: { name: `itest-rt-${stamp}`, memberships: { create: { userId: o.id, role: "OWNER" } } } });
  businessId = biz.id;
  branchId = (await db.branch.create({ data: { businessId, name: "Main" } })).id;
  otherBranch = (await db.branch.create({ data: { businessId, name: "Lakeside" } })).id;
  await db.membership.createMany({
    data: [
      { userId: asha, businessId, role: "WAITER", allBranches: true },
      { userId: bimal, businessId, role: "CASHIER", allBranches: true },
      { userId: outsider, businessId, role: "WAITER", allBranches: false },
      { userId: rider, businessId, role: "RIDER", allBranches: true },
    ],
  });
  const outsiderMembership = await db.membership.findFirstOrThrow({ where: { businessId, userId: outsider } });
  await db.membershipBranch.create({ data: { businessId, membershipId: outsiderMembership.id, branchId: otherBranch } });
  const base = { businessId, branchId, branchIds: [branchId, otherBranch] };
  owner = { ...base, userId: o.id, role: "OWNER" };
  manager = { ...base, userId: o.id, role: "MANAGER" };
  cashier = { ...base, userId: b.id, role: "CASHIER" };
  today = localDate(new Date(), biz.timezone);
});

afterAll(async () => {
  await db.journalLine.deleteMany({ where: { businessId } });
  await db.journalEntry.deleteMany({ where: { businessId } });
  await db.account.deleteMany({ where: { businessId } });
  await db.tipPayoutLine.deleteMany({ where: { businessId } });
  await db.tipPayout.deleteMany({ where: { businessId } });
  await db.tipEntry.deleteMany({ where: { businessId } });
  await db.payAdjustment.deleteMany({ where: { businessId } });
  await db.payrollRun.deleteMany({ where: { businessId } });
  await db.timeEntry.deleteMany({ where: { businessId } });
  await db.rosterShift.deleteMany({ where: { businessId } });
  const members = await db.membership.findMany({ where: { businessId } });
  await db.business.delete({ where: { id: businessId } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await db.$disconnect();
});

describe("the roster", () => {
  it("lists the staff who can be rostered at this branch, not riders or people at other branches", async () => {
    const w = await getRosterWeek(owner, "2026-11-19");
    expect(w.start).toBe(WEEK);
    expect(w.days).toHaveLength(7);
    expect(w.staff.map((s) => s.userId).sort()).toEqual([asha, bimal, owner.userId].sort());
    await expect(getRosterWeek(cashier, WEEK)).rejects.toThrow(/permission/);
  });

  it("adds shifts, refuses clashes, other branches' staff and bad times, and counts hours", async () => {
    await addRosterShift(manager, { userId: asha, date: "2026-11-16", startTime: "09:00", endTime: "15:00" });
    await addRosterShift(manager, { userId: asha, date: "2026-11-16", startTime: "15:00", endTime: "20:00" }); // back to back is fine
    await expect(addRosterShift(manager, { userId: asha, date: "2026-11-16", startTime: "14:00", endTime: "16:00" })).rejects.toThrow(/clashes/);
    await addRosterShift(manager, { userId: asha, date: "2026-11-17", startTime: "22:00", endTime: "03:00" });
    await expect(addRosterShift(manager, { userId: asha, date: "2026-11-18", startTime: "01:00", endTime: "05:00" })).rejects.toThrow(/clashes/); // the night shift runs into it
    await expect(addRosterShift(manager, { userId: outsider, date: "2026-11-16", startTime: "09:00", endTime: "15:00" })).rejects.toThrow(/does not work at this branch/);
    await expect(addRosterShift(manager, { userId: rider, date: "2026-11-16", startTime: "09:00", endTime: "15:00" })).rejects.toThrow(/does not work at this branch/);
    await expect(addRosterShift(manager, { userId: asha, date: "2026-11-19", startTime: "9:00", endTime: "15:00" })).rejects.toThrow(/start and an end/);
    await expect(addRosterShift(manager, { userId: asha, date: "2026-11-19", startTime: "09:00", endTime: "09:00" })).rejects.toThrow(/same/);
    const w = await getRosterWeek(manager, WEEK);
    expect(w.shifts).toHaveLength(3);
    expect(w.minutes[asha]).toBe(360 + 300 + 300);
  });

  it("lets staff see their own shifts, copies a week without clashes, and removes a shift", async () => {
    expect((await myShifts({ ...cashier, userId: asha }, "2026-11-15", 7)).map((s) => s.date)).toEqual(["2026-11-16", "2026-11-16", "2026-11-17"]);
    expect(await myShifts(cashier, "2026-11-15", 7)).toEqual([]);
    expect(await copyWeek(manager, "2026-11-17", "2026-11-22")).toBe(3);
    expect((await getRosterWeek(manager, "2026-11-22")).shifts).toHaveLength(3);
    await expect(copyWeek(manager, "2026-11-17", "2026-11-18")).rejects.toThrow(/different week/);
    await expect(copyWeek(manager, "2026-12-20", "2026-12-27")).rejects.toThrow(/no shifts/);
    const first = (await getRosterWeek(manager, "2026-11-22")).shifts[0]!;
    await removeRosterShift(manager, first.id);
    await expect(removeRosterShift(manager, first.id)).rejects.toThrow(/not found/);
  });
});

describe("tips", () => {
  it("are recorded by whoever handles the drawer, and are posted to the books as owed to staff", async () => {
    await recordTip(cashier, { date: today, amount: 80_000, method: "CARD", note: "Table 4" });
    await recordTip(cashier, { date: today, amount: 20_000, method: "CASH" });
    await expect(recordTip(cashier, { date: "2099-01-01", amount: 1, method: "CASH" })).rejects.toThrow(/future/);
    await expect(recordTip(cashier, { date: today, amount: 0, method: "CASH" })).rejects.toThrow(/above zero/);
    await expect(recordTip(cashier, { date: today, amount: 5, method: "BITCOIN" })).rejects.toThrow(/how the tip was paid/);
    await expect(recordTip({ ...cashier, role: "WAITER" }, { date: today, amount: 5, method: "CASH" })).rejects.toThrow(/permission/);
    expect((await listTips(cashier, today, today)).unshared).toBe(100_000);
    await syncPostings(businessId);
    const payable = await db.account.findFirstOrThrow({ where: { businessId, key: "TIPS_PAYABLE" } });
    const sum = await db.journalLine.aggregate({ where: { businessId, accountId: payable.id }, _sum: { credit: true, debit: true } });
    expect(sum._sum.credit).toBe(100_000);
    const tb = await getTrialBalance(owner, today);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("are shared by hours from the time clock, added to payroll as a bonus, and cannot be shared twice", async () => {
    const at = (h: number) => new Date(`${today}T${String(h).padStart(2, "0")}:00:00Z`);
    await db.timeEntry.createMany({
      data: [
        { businessId, branchId, userId: asha, clockIn: at(2), clockOut: at(8) }, // 6 hours
        { businessId, branchId, userId: bimal, clockIn: at(2), clockOut: at(5) }, // 3 hours
        { businessId, branchId: otherBranch, userId: outsider, clockIn: at(2), clockOut: at(8) }, // another branch: not counted
      ],
    });
    const input = { from: today, to: today, basis: "HOURS", servicePercent: 0 };
    const p = await previewPayout(owner, input);
    expect(p).toMatchObject({ tipsAmount: 100_000, serviceAmount: 0, pooled: 100_000, tipCount: 2 });
    expect(p.lines.map((l) => [l.userId, l.amount])).toEqual(expect.arrayContaining([[asha, 66_667], [bimal, 33_333]]));
    await expect(previewPayout(manager, input)).rejects.toThrow(/owner/);
    await expect(previewPayout(owner, { ...input, basis: "RANDOM" })).rejects.toThrow(/by hours or equally/);
    await expect(previewPayout(owner, { ...input, servicePercent: 150 })).rejects.toThrow(/0 to 100/);

    const payout = await createPayout(owner, input);
    expect(payout.pooled).toBe(100_000);
    const lines = await db.tipPayoutLine.findMany({ where: { payoutId: payout.id } });
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(100_000);
    const adj = await db.payAdjustment.findMany({ where: { businessId, kind: "BONUS" } });
    expect(adj.map((a) => a.amount).sort((x, y) => x - y)).toEqual([33_333, 66_667]);
    expect(adj[0]!.period).toBe(today.slice(0, 7));
    expect((await listTips(owner, today, today)).unshared).toBe(0);
    await expect(createPayout(owner, input)).rejects.toThrow(/nothing to share/);

    // Sharing the tips out takes the wages expense back off, so the business is not charged for staff money.
    await syncPostings(businessId);
    const payable = await db.account.findFirstOrThrow({ where: { businessId, key: "TIPS_PAYABLE" } });
    const sum = await db.journalLine.aggregate({ where: { businessId, accountId: payable.id }, _sum: { credit: true, debit: true } });
    expect(sum._sum.credit).toBe(sum._sum.debit);
    const tb = await getTrialBalance(owner, today);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("adds a share of the service charge when asked, and refuses a month whose payroll is finalized", async () => {
    await recordTip(cashier, { date: today, amount: 10_000, method: "QR" });
    const month = today.slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    await db.payrollRun.create({ data: { businessId, periodStart: `${month}-01`, periodEnd: new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10) } });
    await expect(createPayout(owner, { from: today, to: today, basis: "EQUAL", servicePercent: 0 })).rejects.toThrow(/already finalized/);
    expect((await listTips(owner, today, today)).unshared).toBe(10_000); // nothing was taken
  });
});
