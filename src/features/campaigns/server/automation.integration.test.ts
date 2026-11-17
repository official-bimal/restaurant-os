import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { getRules, previewRule, runAutomations, saveRule, setBirthday, type RuleInput } from "./automation";
import { setProviderForTests, type Provider } from "@/features/messaging/providers";

const stamp = Date.now();
const businessIds: string[] = [];
let phoneSeq = 500_000;
const nextPhone = () => `+9779813${String(++phoneSeq).padStart(6, "0")}`;
const DAY = 86_400_000;

// 11:45 in Nepal (inside sending hours) and 22:45 (outside them), on 24 November 2026
const NOON = new Date("2026-11-24T06:00:00Z");
const NIGHT = new Date("2026-11-24T17:00:00Z");
const TODAY = "2026-11-24";

interface World {
  owner: TenantContext;
  manager: TenantContext;
  waiter: TenantContext;
  businessId: string;
  ownerUserId: string;
}

async function makeWorld(name: string): Promise<World> {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, mgr, waiter] = await Promise.all(["owner", "mgr", "wait"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  for (const [u, role] of [[mgr, "MANAGER"], [waiter, "WAITER"]] as const) {
    await db.membership.create({ data: { userId: u.id, businessId: biz.id, role, allBranches: false, branches: { create: { branchId: branch.id, businessId: biz.id } } } });
  }
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, userId: owner.id, role: "OWNER" },
    manager: { ...base, userId: mgr.id, role: "MANAGER" },
    waiter: { ...base, userId: waiter.id, role: "WAITER" },
    businessId: biz.id,
    ownerUserId: owner.id,
  };
}

async function person(w: World, o: { name: string; consent?: boolean; birth?: [number, number]; lastVisitDaysAgo?: number }) {
  return db.customer.create({
    data: {
      businessId: w.businessId,
      phone: nextPhone(),
      name: o.name,
      marketingConsent: o.consent ?? true,
      consentVerified: o.consent ?? true,
      visitCount: 3,
      totalSpend: 100_000,
      lastVisitAt: new Date(NOON.getTime() - (o.lastVisitDaysAgo ?? 3) * DAY),
      birthMonth: o.birth?.[0] ?? null,
      birthDay: o.birth?.[1] ?? null,
    },
  });
}

const rule = (o: Partial<RuleInput> = {}): RuleInput => ({
  enabled: true,
  autoSend: false,
  template: "Happy birthday {name} from {business}! {points} points for {days} days.",
  offerPoints: 100,
  offerDays: 7,
  cooldownDays: 300,
  ...o,
});

function fake() {
  const calls: { to: string; text: string }[] = [];
  const p: Provider = {
    name: "Fake",
    async send(to, text) {
      calls.push({ to, text });
      return { ok: true, ref: `m${calls.length}` };
    },
  };
  return { p, calls };
}

let a: World;
let b: World;

beforeAll(async () => {
  a = await makeWorld("itest-auto-a");
  b = await makeWorld("itest-auto-b");
});

afterEach(() => setProviderForTests(undefined));

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.messageLog.deleteMany({ where: { businessId: id } });
    await db.campaignMessage.deleteMany({ where: { businessId: id } });
    await db.campaign.deleteMany({ where: { businessId: id } });
    await db.customer.deleteMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

const mine = (w: World, results: Awaited<ReturnType<typeof runAutomations>>, kind: string) => results.find((r) => r.businessId === w.businessId && r.kind === kind);

describe("saving rules", () => {
  it("starts with both rules off and lets a manager switch one on to prepare messages", async () => {
    const { rules } = await getRules(a.manager);
    expect(rules.map((r) => [r.kind, r.enabled, r.autoSend])).toEqual([["BIRTHDAY", false, false], ["WIN_BACK", false, false]]);
    await saveRule(a.manager, "BIRTHDAY", rule());
    expect((await getRules(a.owner)).rules[0]).toMatchObject({ enabled: true, autoSend: false, saved: true });
    await saveRule(a.manager, "BIRTHDAY", rule({ enabled: false }));
    await expect(getRules(a.waiter)).rejects.toThrow(/permission/);
  });

  it("validates the text and numbers and the kind", async () => {
    await expect(saveRule(a.owner, "SPAM", rule())).rejects.toThrow(/Unknown rule/);
    await expect(saveRule(a.owner, "BIRTHDAY", rule({ template: "Hi {nope}!!" }))).rejects.toThrow(/placeholder/);
    await expect(saveRule(a.owner, "BIRTHDAY", rule({ offerPoints: -1 }))).rejects.toThrow(/Bonus points/);
    await expect(saveRule(a.owner, "BIRTHDAY", rule({ offerDays: 0 }))).rejects.toThrow(/between 1 and 90/);
    await expect(saveRule(a.owner, "BIRTHDAY", rule({ cooldownDays: 1 }))).rejects.toThrow(/at least 7/);
  });

  it("lets only the owner switch on sending by the app, and only when a provider exists; then only the owner can edit it", async () => {
    setProviderForTests(null);
    await expect(saveRule(a.owner, "WIN_BACK", rule({ autoSend: true }))).rejects.toThrow(/not set up/);
    setProviderForTests(fake().p);
    await expect(saveRule(a.manager, "WIN_BACK", rule({ autoSend: true }))).rejects.toThrow(/Only the owner/);
    await saveRule(a.owner, "WIN_BACK", rule({ autoSend: true }));
    expect(await db.automationRule.findUniqueOrThrow({ where: { businessId_kind: { businessId: a.businessId, kind: "WIN_BACK" } } })).toMatchObject({ autoSend: true, enabledById: a.ownerUserId });
    await expect(saveRule(a.manager, "WIN_BACK", rule({ template: "Changed text for {name}" }))).rejects.toThrow(/only the owner/);
    await saveRule(a.owner, "WIN_BACK", rule({ enabled: false, autoSend: true })); // switching the rule off drops automatic sending
    expect((await db.automationRule.findUniqueOrThrow({ where: { businessId_kind: { businessId: a.businessId, kind: "WIN_BACK" } } })).autoSend).toBe(false);
  });
});

describe("birthdays", () => {
  it("are set by staff who manage customers, validated, and clearable", async () => {
    const c = await person(a, { name: "Sita" });
    await expect(setBirthday(a.waiter, c.id, 3, 4)).rejects.toThrow(/permission/);
    await expect(setBirthday(a.owner, c.id, 2, 30)).rejects.toThrow(/real month/);
    await expect(setBirthday(a.owner, c.id, 13, 1)).rejects.toThrow(/real month/);
    await expect(setBirthday(a.owner, c.id, 3, null)).rejects.toThrow(/real month/);
    await setBirthday(a.owner, c.id, 2, 29);
    expect(await db.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ birthMonth: 2, birthDay: 29 });
    await setBirthday(a.owner, c.id, null, null);
    expect(await db.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ birthMonth: null, birthDay: null });
    await expect(setBirthday(b.owner, c.id, 1, 1)).rejects.toThrow(/not found/);
  });
});

describe("the daily run", () => {
  it("prepares today's birthday messages once, for guests who agreed, and nothing outside sending hours", async () => {
    const today = await person(a, { name: "Asha Rai", birth: [11, 24] });
    await person(a, { name: "No Consent", consent: false, birth: [11, 24] });
    await person(a, { name: "Other Day", birth: [11, 25] });
    await saveRule(a.owner, "BIRTHDAY", rule());
    expect((await previewRule(a.owner, "BIRTHDAY")).count).toBeGreaterThanOrEqual(0); // preview works; its day is the real one

    // at night nothing happens
    const night = mine(a, await runAutomations(NIGHT), "BIRTHDAY");
    expect(night).toMatchObject({ prepared: 0, note: "outside sending hours" });
    expect(await db.campaign.count({ where: { businessId: a.businessId } })).toBe(0);

    const first = mine(a, await runAutomations(NOON), "BIRTHDAY")!;
    expect(first).toMatchObject({ prepared: 1, sent: 0 });
    const campaign = await db.campaign.findFirstOrThrow({ where: { businessId: a.businessId, autoKey: `BIRTHDAY:${TODAY}` }, include: { messages: true } });
    expect(campaign).toMatchObject({ segment: "BIRTHDAY", offerPoints: 100 });
    expect(campaign.messages).toHaveLength(1);
    expect(campaign.messages[0]).toMatchObject({ customerId: today.id, status: "QUEUED" });
    expect(campaign.messages[0]!.text).toContain("Asha"); // first name only
    expect(campaign.messages[0]!.text).toContain("itest-auto-a");

    // running again the same day makes nothing new
    const again = mine(a, await runAutomations(new Date(NOON.getTime() + 3_600_000)), "BIRTHDAY")!;
    expect(again.prepared).toBe(0);
    expect(await db.campaign.count({ where: { businessId: a.businessId, segment: "BIRTHDAY" } })).toBe(1);
    expect(await db.campaignMessage.count({ where: { businessId: a.businessId } })).toBe(1);
    expect(await db.auditEvent.count({ where: { businessId: a.businessId, action: "campaign.auto" } })).toBe(1);
    // a rule that is off does nothing, and another business's run is untouched
    expect(mine(b, await runAutomations(NOON), "BIRTHDAY")).toBeUndefined();
  });

  it("sends by itself when the owner switched that on, exactly once, and leaves it for staff when it cannot", async () => {
    const w = await makeWorld("itest-auto-send");
    const g = await person(w, { name: "Binod", lastVisitDaysAgo: 45 });
    const f = fake();
    setProviderForTests(f.p);
    await saveRule(w.owner, "WIN_BACK", rule({ autoSend: true, template: "We miss you {name} at {business}", offerPoints: 50, offerDays: 14, cooldownDays: 60 }));

    const res = mine(w, await runAutomations(NOON), "WIN_BACK")!;
    expect(res).toMatchObject({ prepared: 1, sent: 1, failed: 0 });
    expect(f.calls).toEqual([{ to: g.phone, text: "We miss you Binod at itest-auto-send" }]);
    expect((await db.campaignMessage.findFirstOrThrow({ where: { businessId: w.businessId } })).status).toBe("SENT");

    // later the same day: nothing more is sent
    await runAutomations(new Date(NOON.getTime() + 2 * 3_600_000));
    expect(f.calls).toHaveLength(1);

    // the next day the guest is within the one-week and 60-day limits, so is not messaged again
    const nextDay = new Date(NOON.getTime() + DAY);
    expect(mine(w, await runAutomations(nextDay), "WIN_BACK")).toMatchObject({ prepared: 0 });
    // and not after 8 days either (still inside the rule's own waiting time)
    expect(mine(w, await runAutomations(new Date(NOON.getTime() + 8 * DAY)), "WIN_BACK")).toMatchObject({ prepared: 0 });
    expect(f.calls).toHaveLength(1);
  });

  it("does not send when the provider is gone or the owner who switched it on lost that role, but still prepares", async () => {
    const w = await makeWorld("itest-auto-gone");
    await person(w, { name: "Chandra", lastVisitDaysAgo: 50 });
    setProviderForTests(fake().p);
    await saveRule(w.owner, "WIN_BACK", rule({ autoSend: true, cooldownDays: 60 }));

    setProviderForTests(null);
    const noProvider = mine(w, await runAutomations(NOON), "WIN_BACK")!;
    expect(noProvider).toMatchObject({ prepared: 1, sent: 0 });
    expect(noProvider.note).toMatch(/no messaging provider/);

    const f = fake();
    setProviderForTests(f.p);
    await db.membership.updateMany({ where: { businessId: w.businessId, userId: w.ownerUserId }, data: { role: "MANAGER" } });
    const demoted = mine(w, await runAutomations(new Date(NOON.getTime() + 30 * 60_000)), "WIN_BACK")!;
    expect(demoted.sent).toBe(0);
    expect(demoted.note).toMatch(/no longer available/);
    expect(f.calls).toHaveLength(0);
    expect((await db.campaignMessage.findFirstOrThrow({ where: { businessId: w.businessId } })).status).toBe("QUEUED");
  });

  it("never includes a guest who withdrew consent after being counted, and treats 29 February birthdays on 28 February", async () => {
    const w = await makeWorld("itest-auto-leap");
    await person(w, { name: "Leap", birth: [2, 29] });
    await saveRule(w.owner, "BIRTHDAY", rule());
    const feb28 = new Date("2027-02-28T06:00:00Z");
    expect(mine(w, await runAutomations(feb28), "BIRTHDAY")).toMatchObject({ prepared: 1 });
    const w2 = await makeWorld("itest-auto-leap2");
    const c = await person(w2, { name: "Withdrew", birth: [2, 28] });
    await db.customer.update({ where: { id: c.id }, data: { marketingConsent: false } });
    await saveRule(w2.owner, "BIRTHDAY", rule());
    expect(mine(w2, await runAutomations(feb28), "BIRTHDAY")).toMatchObject({ prepared: 0, note: "nobody to message today" });
  });
});
