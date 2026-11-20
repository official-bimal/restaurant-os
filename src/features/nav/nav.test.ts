import { describe, expect, it } from "vitest";
import { buildNav, sectionOf } from "./nav";

const base = { multiBranch: false, hukka: false, counts: {} };
const hrefs = (role: Parameters<typeof buildNav>[0]["role"], over: Partial<Parameters<typeof buildNav>[0]> = {}) => {
  const n = buildNav({ role, ...base, ...over });
  return [...n.home, ...n.sections.flatMap((s) => s.items)].map((e) => e.href);
};

describe("navigation", () => {
  it("shows an owner everything except what the business has not switched on", () => {
    const h = hrefs("OWNER");
    for (const p of ["/dashboard", "/orders", "/kitchen", "/menu", "/stock", "/reports", "/accounting", "/staff", "/settings", "/owner"]) expect(h).toContain(p);
    expect(h).not.toContain("/branches");
    expect(h).not.toContain("/hukka");
  });
  it("shows branch tools only when several branches are switched on", () => {
    expect(hrefs("OWNER", { multiBranch: true })).toContain("/branches");
    expect(hrefs("MANAGER", { multiBranch: true })).not.toContain("/branches"); // managers do not manage branches
  });
  it("shows the hukka timer only to people who handle orders at a business that sells hukka", () => {
    expect(hrefs("WAITER", { hukka: true })).toContain("/hukka");
    expect(hrefs("KITCHEN", { hukka: true })).not.toContain("/hukka");
    expect(hrefs("WAITER", { hukka: false })).not.toContain("/hukka");
  });
  it("gives each role only what it may use, and no empty sections", () => {
    const waiter = buildNav({ role: "WAITER", ...base });
    expect(waiter.sections.every((s) => s.items.length > 0)).toBe(true);
    const h = hrefs("WAITER");
    expect(h).toContain("/orders");
    expect(h).not.toContain("/menu");
    expect(h).not.toContain("/accounting");
    expect(hrefs("KITCHEN")).toEqual(expect.arrayContaining(["/kitchen", "/stock"]));
    expect(hrefs("KITCHEN")).not.toContain("/orders/new");
  });
  it("shows an accountant the books, bills and reports and nothing to run the floor", () => {
    const h = hrefs("ACCOUNTANT");
    expect(h).toEqual(expect.arrayContaining(["/dashboard", "/accounting", "/reports", "/bills"]));
    for (const p of ["/orders", "/kitchen", "/menu", "/stock", "/staff", "/time", "/settings/payments", "/owner"]) expect(h).not.toContain(p);
    // Everyone can open Settings for their own dashboard and appearance; business setup stays with the owner.
    expect(h).toEqual(expect.arrayContaining(["/settings", "/settings/dashboard", "/settings/appearance"]));
  });
  it("carries the badge counts", () => {
    const n = buildNav({ role: "OWNER", ...base, counts: { onlineWaiting: 3, lowStock: 2, notifications: 5 } });
    const all = [...n.home, ...n.sections.flatMap((s) => s.items)];
    expect(all.find((e) => e.href === "/online")?.badge).toBe(3);
    expect(all.find((e) => e.href === "/stock")?.badge).toBe(2);
    expect(all.find((e) => e.href === "/notifications")?.badge).toBe(5);
  });
  it("finds the section a page is in", () => {
    const { sections } = buildNav({ role: "OWNER", ...base });
    expect(sectionOf(sections, "/orders/abc")).toBe("service");
    expect(sectionOf(sections, "/stock/recipes")).toBe("menu");
    expect(sectionOf(sections, "/accounting/daybook")).toBe("money");
    expect(sectionOf(sections, "/dashboard")).toBeNull();
  });
});
