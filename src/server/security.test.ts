import { beforeAll, describe, expect, it } from "vitest";
import { createGuestToken, createSessionToken, verifyGuestToken, verifySessionToken } from "./session";
import { assertAcceptablePassword, generateTempPassword } from "./passwords";
import { can, canManageRole } from "./permissions";

beforeAll(() => {
  process.env.SESSION_SECRET = "x".repeat(40);
});

describe("session token", () => {
  it("round-trips user and session version", () => {
    const t = createSessionToken("u1", 3);
    expect(verifySessionToken(t)).toEqual({ userId: "u1", sessionVersion: 3 });
  });

  it("rejects tampering, truncation, junk and expiry", () => {
    const t = createSessionToken("u1", 0);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", sv: 0, exp: 9_999_999_999 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`)).toBeNull();
    expect(verifySessionToken(`${body}.`)).toBeNull();
    expect(verifySessionToken(`${body}.${sig}.extra`)).toBeNull();
    expect(verifySessionToken("not-a-token")).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
    const future = Date.now() + 13 * 60 * 60 * 1000;
    expect(verifySessionToken(t, future)).toBeNull();
  });
});

describe("guest token", () => {
  it("round-trips the sitting and table", () => {
    const t = createGuestToken({ sessionId: "s1", tableId: "t1" });
    expect(verifyGuestToken(t)).toEqual({ sessionId: "s1", tableId: "t1" });
  });

  it("rejects tampering, junk and expiry", () => {
    const t = createGuestToken({ sessionId: "s1", tableId: "t1" });
    const [g, body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ sid: "s2", tid: "t1", exp: 9_999_999_999 })).toString("base64url");
    expect(verifyGuestToken(`${g}.${forged}.${sig}`)).toBeNull();
    expect(verifyGuestToken(`x.${body}.${sig}`)).toBeNull();
    expect(verifyGuestToken("junk")).toBeNull();
    expect(verifyGuestToken(undefined)).toBeNull();
    expect(verifyGuestToken(t, Date.now() + 7 * 60 * 60 * 1000)).toBeNull();
  });

  it("is never interchangeable with a staff session token", () => {
    const staff = createSessionToken("u1", 0);
    const guest = createGuestToken({ sessionId: "s1", tableId: "t1" });
    expect(verifyGuestToken(staff)).toBeNull();
    expect(verifySessionToken(guest)).toBeNull();
  });
});

describe("temporary passwords", () => {
  it("are 12 characters from the readable alphabet and differ each time", () => {
    const a = generateTempPassword();
    const b = generateTempPassword();
    expect(a).toMatch(/^[A-HJ-NP-Za-km-z2-9]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe("password rules", () => {
  it("accepts a normal password and rejects weak ones", () => {
    expect(() => assertAcceptablePassword("correct-horse-battery", "a@b.test")).not.toThrow();
    expect(() => assertAcceptablePassword("short", "a@b.test")).toThrow("at least");
    expect(() => assertAcceptablePassword("A@B.test-A@B", "a@b.test")).not.toThrow();
    expect(() => assertAcceptablePassword("owner@demo.test", "OWNER@demo.test")).toThrow("same as the email");
    expect(() => assertAcceptablePassword("aaaaaaaaaaaa", "a@b.test")).toThrow("repetitive");
  });
});

describe("who may manage whom", () => {
  it("lets owners manage everyone", () => {
    for (const r of ["OWNER", "MANAGER", "CASHIER", "WAITER", "KITCHEN"] as const) {
      expect(canManageRole("OWNER", r)).toBe(true);
    }
  });

  it("lets managers manage only roles below manager", () => {
    expect(canManageRole("MANAGER", "CASHIER")).toBe(true);
    expect(canManageRole("MANAGER", "WAITER")).toBe(true);
    expect(canManageRole("MANAGER", "KITCHEN")).toBe(true);
    expect(canManageRole("MANAGER", "MANAGER")).toBe(false);
    expect(canManageRole("MANAGER", "OWNER")).toBe(false);
  });

  it("gives everyone else no staff access", () => {
    for (const actor of ["CASHIER", "WAITER", "KITCHEN"] as const) {
      expect(can(actor, "staff.manage")).toBe(false);
      expect(canManageRole(actor, "KITCHEN")).toBe(false);
    }
  });
});
