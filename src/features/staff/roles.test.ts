import { describe, expect, it } from "vitest";
import { basePermissions, can, isPermission } from "@/server/permissions";
import { BASE_ROLES, cleanRole, GRANTABLE, PERMISSION_GROUPS } from "./roles";

describe("can() with a custom role", () => {
  it("still works with a plain role", () => {
    expect(can("OWNER", "owner.control")).toBe(true);
    expect(can("WAITER", "bill.refund")).toBe(false);
  });
  it("uses the built-in permissions when there is no custom set", () => {
    expect(can({ role: "CASHIER" }, "bill.checkout")).toBe(true);
    expect(can({ role: "CASHIER" }, "bill.refund")).toBe(false);
  });
  it("replaces them when a custom set is given", () => {
    const lead = { role: "WAITER" as const, permissions: ["order.create", "bill.refund"] as const };
    expect(can(lead, "bill.refund")).toBe(true);
    expect(can(lead, "order.edit")).toBe(false); // a plain waiter could, this lead was not given it
  });
});

describe("custom role rules", () => {
  const ok = { name: "  Shift   lead ", color: "emerald", baseRole: "CASHIER", permissions: ["bill.checkout", "bill.refund", "bill.checkout"] };
  it("tidies the name and removes repeats", () => {
    expect(cleanRole(ok)).toEqual({ name: "Shift lead", color: "emerald", baseRole: "CASHIER", permissions: ["bill.checkout", "bill.refund"] });
  });
  it("never lets a role carry owner powers, whatever is posted", () => {
    const r = cleanRole({ ...ok, permissions: ["owner.control", "staff.manage", "order.create", "made.up"] });
    expect(r.permissions).toEqual(["order.create"]);
    expect(() => cleanRole({ ...ok, permissions: ["owner.control"] })).toThrow(/Tick at least one/);
  });
  it("checks name, colour and base role", () => {
    expect(() => cleanRole({ ...ok, name: "x" })).toThrow(/name/);
    expect(() => cleanRole({ ...ok, color: "pink" })).toThrow(/colour/);
    expect(() => cleanRole({ ...ok, baseRole: "OWNER" })).toThrow(/based on/);
  });
  it("lists every permission once on the screen, and every one is real", () => {
    const keys = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(isPermission)).toBe(true);
    // Every permission a built-in role (other than owner-only ones) holds can be ticked.
    for (const r of BASE_ROLES) for (const p of basePermissions(r)) if (p !== "staff.manage") expect(GRANTABLE).toContain(p);
  });
});
