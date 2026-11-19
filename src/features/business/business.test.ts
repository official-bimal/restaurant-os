import { describe, expect, it } from "vitest";
import { cleanLink, cleanProfile, type ProfileInput } from "./profile";
import { describeAction, detailText } from "./activity";
import { trashCutoff, TRASH_DAYS } from "./trash";

const base: ProfileInput = { name: "Nerro Cafe", legalName: "", panNumber: "", phone: "", email: "", address: "", businessType: "", openedOn: "", website: "", facebook: "", instagram: "" };

describe("business profile", () => {
  it("turns empty boxes into nothing and tidies spaces", () => {
    const r = cleanProfile({ ...base, name: "  Nerro   Cafe ", address: "Lakeside   Pokhara" });
    expect(r).toMatchObject({ name: "Nerro Cafe", address: "Lakeside Pokhara", legalName: null, phone: null, email: null, website: null });
  });
  it("needs a name and checks email, phone, PAN and date", () => {
    expect(() => cleanProfile({ ...base, name: " " })).toThrow(/name/);
    expect(() => cleanProfile({ ...base, email: "nope" })).toThrow(/email/);
    expect(() => cleanProfile({ ...base, phone: "call me" })).toThrow(/phone/);
    expect(() => cleanProfile({ ...base, panNumber: "1 2" })).toThrow(/PAN/);
    expect(() => cleanProfile({ ...base, openedOn: "2026-13-40" })).toThrow(/date/);
    expect(cleanProfile({ ...base, openedOn: "2024-04-14", phone: "+977 61-000000" }).openedOn).toBe("2024-04-14");
  });
  it("keeps social handles and https links, refuses scripts", () => {
    expect(cleanLink("@nerrocafe")).toBe("nerrocafe");
    expect(cleanLink("https://facebook.com/nerro")).toBe("https://facebook.com/nerro");
    expect(() => cleanLink("javascript:alert(1)")).toThrow();
    expect(() => cleanProfile({ ...base, website: "nerro.com" })).toThrow(/https/);
    expect(cleanLink("")).toBeNull();
  });
});

describe("activity words", () => {
  it("names known actions and tidies unknown ones", () => {
    expect(describeAction("menu.item.delete")).toBe("Deleted a dish");
    expect(describeAction("refund.create")).toBe("Refund create");
    expect(describeAction("orderVoid")).toBe("Order Void");
  });
  it("lists only simple details and cuts them short", () => {
    expect(detailText({ name: "Momo", nested: { a: 1 }, n: 3, none: null })).toBe("name: Momo, n: 3");
    expect(detailText(null)).toBe("");
    expect(detailText({ x: "y".repeat(500) }).length).toBeLessThanOrEqual(160);
  });
});

describe("trash", () => {
  it("keeps things for the set number of days", () => {
    const now = new Date("2026-12-31T00:00:00Z");
    expect(now.getTime() - trashCutoff(now).getTime()).toBe(TRASH_DAYS * 86_400_000);
  });
});
