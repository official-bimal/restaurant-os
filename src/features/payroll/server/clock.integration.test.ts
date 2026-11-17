import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { setPushSender } from "@/features/notifications/server/push";
import { listNotifications } from "@/features/notifications/server/service";
import { clockIn, clockOut, getAttendance, getClockSettings, setClockSettings } from "./time";

const stamp = Date.now();
const businessIds: string[] = [];

const CAFE = { lat: 28.2096, lng: 83.9856 };
const here = (accuracy = 10) => ({ ...CAFE, accuracy });
const far = () => ({ lat: CAFE.lat + 0.01, lng: CAFE.lng, accuracy: 10 }); // about 1.1 km away

interface World {
  owner: TenantContext;
  manager: TenantContext;
  waiter: TenantContext;
  cashier: TenantContext;
  branchId: string;
  tz: string;
}

async function makeWorld(name: string, withLocation = true): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, mgr, waiter, cashier] = await Promise.all(["owner", "mgr", "wait", "cash"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Lakeside", ...(withLocation ? { latitude: CAFE.lat, longitude: CAFE.lng } : {}) } });
  for (const [u, role] of [[mgr, "MANAGER"], [waiter, "WAITER"], [cashier, "CASHIER"]] as const) {
    await db.membership.create({ data: { userId: u.id, businessId: biz.id, role, allBranches: false, branches: { create: { branchId: branch.id, businessId: biz.id } } } });
  }
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  const { timezone } = await db.business.findUniqueOrThrow({ where: { id: biz.id }, select: { timezone: true } });
  return {
    owner: { ...base, userId: owner.id, role: "OWNER" },
    manager: { ...base, userId: mgr.id, role: "MANAGER" },
    waiter: { ...base, userId: waiter.id, role: "WAITER" },
    cashier: { ...base, userId: cashier.id, role: "CASHIER" },
    branchId: branch.id,
    tz: timezone,
  };
}

afterEach(() => setPushSender(null));

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.pushSubscription.deleteMany({ where: { businessId: id } });
    await db.timeEntry.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(new Date());

describe("clocking in by location", () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld("itest-clock-a");
  });

  it("is open to anyone while the rule is off, and notes the distance when a reading is given", async () => {
    const e = await clockIn(w.waiter, far());
    expect(e.inDistanceM).toBeGreaterThan(1000);
    await clockOut(w.waiter);
    const none = await clockIn(w.waiter);
    expect(none.inDistanceM).toBeNull();
    await clockOut(w.waiter);
  });

  it("only managers can change the rule, it needs the branch to have a location, and the radius is kept sensible", async () => {
    await expect(setClockSettings(w.waiter, { requireLocation: true, radius: 150 })).rejects.toThrow(/permission/);
    const bare = await makeWorld("itest-clock-bare", false);
    await expect(setClockSettings(bare.owner, { requireLocation: true, radius: 150 })).rejects.toThrow(/location on the Branches page/);
    await setClockSettings(w.manager, { requireLocation: true, radius: 5 });
    expect(await getClockSettings(w.manager)).toMatchObject({ requireLocation: true, radius: 30, hasLocation: true });
    await setClockSettings(w.manager, { requireLocation: true, radius: 150 });
  });

  it("with the rule on, lets someone at the cafe clock in and records how far, but not anyone else", async () => {
    await expect(clockIn(w.waiter, far())).rejects.toThrow(/about \d+ m from Lakeside/);
    await expect(clockIn(w.waiter)).rejects.toThrow(/Allow location/);
    await expect(clockIn(w.waiter, { lat: "x" })).rejects.toThrow(/Allow location/);
    await expect(clockIn(w.waiter, here(400))).rejects.toThrow(/not exact enough/);
    expect(await db.timeEntry.count({ where: { userId: w.waiter.userId } })).toBe(2); // only the two from before the rule
    const ok = await clockIn(w.waiter, { ...CAFE, accuracy: 12 });
    expect(ok.inDistanceM).toBe(0);
    await expect(clockIn(w.waiter, here())).rejects.toThrow(/already clocked in/);
  });

  it("lets a person clock out away from the cafe, but records it and does not require a reading", async () => {
    await clockOut(w.waiter, far());
    const last = await db.timeEntry.findFirstOrThrow({ where: { userId: w.waiter.userId }, orderBy: { clockIn: "desc" } });
    expect(last.outAway).toBe(true);
    expect(last.outDistanceM).toBeGreaterThan(1000);
    await clockIn(w.cashier, here());
    await clockOut(w.cashier); // no reading at all: still allowed
    const c = await db.timeEntry.findFirstOrThrow({ where: { userId: w.cashier.userId } });
    expect(c).toMatchObject({ outAway: false, outDistanceM: null });
    await clockIn(w.cashier, here());
    await clockOut(w.cashier, here());
    expect((await db.timeEntry.findFirst({ where: { userId: w.cashier.userId }, orderBy: { clockIn: "desc" } }))?.outDistanceM).toBe(0);
  });
});

describe("telling the owner, and the daily attendance", () => {
  it("sends a push to managers who can see time when someone clocks in and out, and lists it in notifications", async () => {
    const w = await makeWorld("itest-clock-push");
    const sent: { title: string; body: string }[] = [];
    await db.pushSubscription.create({ data: { userId: w.manager.userId, businessId: w.manager.businessId, endpoint: `https://push.example.test/m-${stamp}`, p256dh: "B".repeat(87), auth: "A".repeat(22) } });
    await db.pushSubscription.create({ data: { userId: w.waiter.userId, businessId: w.waiter.businessId, endpoint: `https://push.example.test/w-${stamp}`, p256dh: "B".repeat(87), auth: "A".repeat(22) } });
    setPushSender(async (sub, payload) => {
      if (sub.endpoint.includes("/m-")) sent.push(JSON.parse(payload));
      else throw new Error("a waiter must not be told");
    });
    await clockIn(w.waiter);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent.map((s) => s.title)).toEqual([`${(await db.user.findUniqueOrThrow({ where: { id: w.waiter.userId } })).name} clocked in`]);
    await clockOut(w.waiter, far());
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.title).toMatch(/clocked out/);
    expect(sent[1]!.body).toMatch(/worked 0h 0\d?m/);

    const mine = (await listNotifications(w.manager)).filter((n) => n.kind === "CLOCK");
    expect(mine.map((n) => n.title.split(" ").slice(-2).join(" ")).sort()).toEqual(["clocked in", "clocked out"]);
    expect((await listNotifications(w.waiter)).filter((n) => n.kind === "CLOCK")).toHaveLength(0);
  });

  it("shows who is in, who came and left, and who was off, for any day, only for managers", async () => {
    const w = await makeWorld("itest-clock-att");
    await clockIn(w.waiter);
    await clockIn(w.cashier);
    await clockOut(w.cashier);
    const att = await getAttendance(w.manager, today());
    const by = Object.fromEntries(att.rows.map((r) => [r.userId, r]));
    expect(by[w.waiter.userId]).toMatchObject({ status: "IN", shifts: 1 });
    expect(by[w.cashier.userId]).toMatchObject({ status: "DONE", shifts: 1 });
    expect(by[w.manager.userId]).toMatchObject({ status: "OFF", shifts: 0, firstIn: null });
    expect(att.counts).toEqual({ in: 1, done: 1, off: att.rows.length - 2 });
    // a day with nothing recorded: everyone is off
    const yesterday = await getAttendance(w.manager, "2020-01-01");
    expect(yesterday.counts.off).toBe(yesterday.rows.length);
    await expect(getAttendance(w.waiter, today())).rejects.toThrow(/permission/);
    // another business sees none of this
    const other = await makeWorld("itest-clock-att2");
    expect((await getAttendance(other.owner, today())).counts.in).toBe(0);
  });
});
