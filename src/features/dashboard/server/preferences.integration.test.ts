import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { getEditorState, getPreferences, getTheme, resetLayout, saveAppearance, saveBusinessAccent, saveLayout, saveTemplate, setWidgetVisibility } from "./preferences";
import { loadDashboard } from "./data";
import { setLogo } from "@/features/business/server/profile";

const stamp = Date.now();
const businessIds: string[] = [];

async function world(name: string) {
  const mk = (s: string) => db.user.create({ data: { email: `${name}-${s}-${stamp}@it.test`, name: `${name} ${s}`, passwordHash: "x" } });
  const [owner, waiter] = await Promise.all(["owner", "wait"].map(mk));
  const biz = await db.business.create({ data: { name, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  businessIds.push(biz.id);
  await db.membership.create({ data: { userId: waiter.id, businessId: biz.id, role: "WAITER" } });
  const branch = await db.branch.create({ data: { businessId: biz.id, name: "Main" } });
  const base = { businessId: biz.id, branchId: branch.id, branchIds: [branch.id] };
  return {
    owner: { ...base, userId: owner.id, role: "OWNER" } as TenantContext,
    waiter: { ...base, userId: waiter.id, role: "WAITER" } as TenantContext,
  };
}

let a: Awaited<ReturnType<typeof world>>;
let b: Awaited<ReturnType<typeof world>>;
const png = () => {
  const x = new Uint8Array(100).fill(1);
  x.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return x;
};

beforeAll(async () => {
  a = await world("itest-dash-a");
  b = await world("itest-dash-b");
});

afterAll(async () => {
  for (const id of businessIds) {
    const members = await db.membership.findMany({ where: { businessId: id } });
    await db.business.delete({ where: { id } });
    await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  }
  await db.$disconnect();
});

const cfg = {
  v: 1,
  desktop: { order: [{ id: "floor", size: "M" }, { id: "salesToday", size: "S" }, { id: "openOrders", size: "S" }], hidden: ["salesToday"] },
  mobile: { order: [{ id: "openOrders", size: "S" }, { id: "floor", size: "M" }], hidden: [] },
};

describe("dashboard layout persistence", () => {
  it("starts with the safe default for a new person", async () => {
    const p = await getPreferences(a.owner);
    expect(p).toEqual({ themeMode: "SYSTEM", accent: null, template: "CLASSIC", layout: null });
    const st = await getEditorState(a.owner);
    expect(st.customised).toBe(false);
    expect(st.current.desktop.visible[0]!.id).toBe("salesToday");
  });

  it("saves a rearranged layout, and it is there again in a fresh session", async () => {
    await saveLayout(a.owner, cfg);
    // A new request (after a refresh, a sign-out and sign-in, or another device) reads it from the database.
    const again = await getEditorState({ ...a.owner });
    expect(again.customised).toBe(true);
    expect(again.current.desktop.visible.slice(0, 2).map((p) => p.id)).toEqual(["floor", "openOrders"]);
    // Hidden by choice, plus the cards the standard Classic layout leaves off until switched on.
    expect(again.current.desktop.hidden.map((p) => p.id)).toEqual(expect.arrayContaining(["salesToday", "revenue7"]));
    expect(again.current.desktop.hidden.map((p) => p.id)).not.toContain("floor");
    expect(again.current.mobile.visible.map((p) => p.id).slice(0, 2)).toEqual(["openOrders", "floor"]);
    expect(await db.userPreference.count({ where: { userId: a.owner.userId } })).toBe(1);
  });

  it("is personal: the waiter and the other business are untouched", async () => {
    expect((await getPreferences(a.waiter)).layout).toBeNull();
    expect((await getPreferences(b.owner)).layout).toBeNull();
    await saveLayout(b.owner, { ...cfg, desktop: { order: [{ id: "tablesInUse", size: "M" }], hidden: [] } });
    expect((await getPreferences(a.owner)).layout!.desktop.order[0]!.id).toBe("floor");
    expect((await getPreferences(b.owner)).layout!.desktop.order[0]!.id).toBe("tablesInUse");
    // The same person in one business has no settings carried into another.
    const crossed = { ...b.owner, userId: a.owner.userId };
    expect((await getPreferences(crossed)).layout).toBeNull();
  });

  it("refuses broken layouts and leaves the saved one alone", async () => {
    await expect(saveLayout(a.owner, "nope")).rejects.toThrow(/not valid/);
    await expect(saveLayout(a.owner, { desktop: 1, mobile: 2 })).rejects.toThrow(/not valid/);
    expect((await getPreferences(a.owner)).layout!.desktop.order[0]!.id).toBe("floor");
  });

  it("does not keep widgets the person may not see", async () => {
    const saved = await saveLayout(a.waiter, { v: 1, desktop: { order: [{ id: "salesToday", size: "S" }, { id: "floor", size: "M" }], hidden: [] }, mobile: { order: [], hidden: [] } });
    expect(saved.desktop.order.map((p) => p.id)).toEqual(["floor"]);
    const st = await getEditorState(a.waiter);
    expect(st.widgets.some((w) => w.id === "salesToday")).toBe(false);
    expect(st.widgets.some((w) => w.id === "openOrders")).toBe(true);
  });

  it("changing the template keeps the arranged and hidden widgets", async () => {
    await saveTemplate(a.owner, "MODERN");
    const p = await getPreferences(a.owner);
    expect(p.template).toBe("MODERN");
    expect(p.layout!.desktop.hidden).toEqual(["salesToday"]);
    expect((await getEditorState(a.owner)).current.desktop.visible[0]!.id).toBe("floor");
    await expect(saveTemplate(a.owner, "FANCY")).rejects.toThrow(/three/);
    expect((await getPreferences(a.owner)).template).toBe("MODERN");
  });

  it("shows or hides widgets from the visibility list without losing order", async () => {
    await setWidgetVisibility(a.owner, ["floor", "salesToday", "billsPaid"]);
    const st = await getEditorState(a.owner);
    expect(st.current.desktop.visible.map((p) => p.id)).toEqual(["floor", "billsPaid", "salesToday"]) // a card shown again joins the end;
    expect(st.current.desktop.hidden.length).toBe(st.widgets.length - 3);
  });

  it("resets to the standard layout and keeps the template", async () => {
    await resetLayout(a.owner);
    const p = await getPreferences(a.owner);
    expect(p.layout).toBeNull();
    expect(p.template).toBe("MODERN");
    expect((await getEditorState(a.owner)).customised).toBe(false);
  });

  it("falls back to the default when a stored layout is damaged", async () => {
    await db.userPreference.update({ where: { userId_businessId: { userId: a.owner.userId, businessId: a.owner.businessId } }, data: { dashboardLayout: { broken: true } } });
    expect((await getPreferences(a.owner)).layout).toBeNull();
    await resetLayout(a.owner);
  });
});

describe("appearance and branding", () => {
  it("saves mode and accent per person and picks the colour in force", async () => {
    await saveAppearance(a.owner, { themeMode: "DARK", accent: "#BE123C" });
    expect(await getTheme(a.owner)).toEqual({ mode: "DARK", accent: "#be123c" });
    expect(await getTheme(a.waiter)).toEqual({ mode: "SYSTEM", accent: "#4f46e5" });
    await expect(saveAppearance(a.owner, { themeMode: "DARK", accent: "red" })).rejects.toThrow(/colour/);
    expect((await getTheme(a.owner)).accent).toBe("#be123c");
  });

  it("lets only the owner set the business colour, which others inherit unless they chose their own", async () => {
    await expect(saveBusinessAccent(a.waiter, "#047857")).rejects.toThrow(/owner/);
    await saveBusinessAccent(a.owner, "#047857");
    expect((await getTheme(a.waiter)).accent).toBe("#047857");
    expect((await getTheme(a.owner)).accent).toBe("#be123c"); // their own choice wins
    expect((await getTheme(b.waiter)).accent).toBe("#4f46e5"); // another business is unaffected
    await saveAppearance(a.owner, { themeMode: "LIGHT", accent: null });
    expect((await getTheme(a.owner)).accent).toBe("#047857");
    expect(await db.auditEvent.count({ where: { businessId: a.owner.businessId, action: "business.accent" } })).toBe(1);
  });

  it("keeps the logo with the business, owner only", async () => {
    await expect(setLogo(a.waiter, png())).rejects.toThrow(/owner/);
    await setLogo(a.owner, png());
    expect(await db.businessLogo.count({ where: { businessId: a.owner.businessId } })).toBe(1);
    expect(await db.businessLogo.count({ where: { businessId: b.owner.businessId } })).toBe(0);
  });
});

describe("dashboard data", () => {
  it("loads only for the person's own business and only what the person may see", async () => {
    const all = new Set(["salesToday", "revenue7", "salesByHour", "lowStockProducts", "recentTransactions", "customerOverview", "floor", "topSelling"]);
    const owner = await loadDashboard(a.owner, all);
    expect(owner.business.name).toBe("itest-dash-a");
    expect(owner.day).not.toBeNull();
    expect(owner.charts).not.toBeNull();
    expect(owner.customers).toEqual({ total: 0, newWeek: 0, returning: 0, withConsent: 0 });
    const waiter = await loadDashboard(a.waiter, all);
    expect(waiter.day).toBeNull();
    expect(waiter.charts).toBeNull();
    expect(waiter.customers).toBeNull();
    expect(waiter.recent).toEqual([]);
    expect(waiter.lowStockItems).toEqual([]);
  });

  it("does not run the heavy queries for widgets that are not shown", async () => {
    const d = await loadDashboard(a.owner, new Set(["openOrders"]));
    expect(d.day).toBeNull();
    expect(d.charts).toBeNull();
    expect(d.customers).toBeNull();
  });

  it("shows real figures and never another business's", async () => {
    const cust = await db.customer.create({ data: { businessId: a.owner.businessId, phone: `+97798${String(stamp).slice(-8)}`, name: "Sita", visitCount: 3 } });
    await db.customer.create({ data: { businessId: b.owner.businessId, phone: `+97797${String(stamp).slice(-8)}`, name: "Other" } });
    const d = await loadDashboard(a.owner, new Set(["customerOverview"]));
    expect(d.customers).toMatchObject({ total: 1, newWeek: 1, returning: 1 });
    await db.customer.delete({ where: { businessId_id: { businessId: a.owner.businessId, id: cust.id } } });
  });
});
