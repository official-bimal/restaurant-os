import { describe, expect, it } from "vitest";
import { clashes, isValidTime, shareOut, shiftMinutes, weekDays, weekStartOf } from "./roster";

describe("weeks", () => {
  it("start on Sunday", () => {
    expect(weekStartOf("2026-11-19")).toBe("2026-11-15"); // a Thursday
    expect(weekStartOf("2026-11-15")).toBe("2026-11-15"); // the Sunday itself
    expect(weekStartOf("2026-11-21")).toBe("2026-11-15"); // Saturday
    expect(weekDays("2026-11-15")).toEqual(["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
  });
});

describe("shifts", () => {
  it("counts minutes, across midnight too", () => {
    expect(shiftMinutes("09:00", "17:30")).toBe(510);
    expect(shiftMinutes("22:00", "02:00")).toBe(240);
    expect(shiftMinutes("09:00", "09:00")).toBe(0);
    expect(isValidTime("07:05")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
  });
  it("finds a person's clashing shifts", () => {
    const a = { date: "2026-11-19", start: "09:00", end: "15:00" };
    expect(clashes(a, { date: "2026-11-19", start: "14:00", end: "20:00" })).toBe(true);
    expect(clashes(a, { date: "2026-11-19", start: "15:00", end: "20:00" })).toBe(false); // back to back is fine
    expect(clashes(a, { date: "2026-11-20", start: "09:00", end: "15:00" })).toBe(false);
    // A night shift that runs into the next morning clashes with an early start then, and not with a later one.
    const night = { date: "2026-11-19", start: "22:00", end: "03:00" };
    expect(clashes(night, { date: "2026-11-20", start: "02:00", end: "08:00" })).toBe(true);
    expect(clashes(night, { date: "2026-11-20", start: "03:00", end: "08:00" })).toBe(false);
    expect(clashes({ date: "2026-11-20", start: "02:00", end: "08:00" }, night)).toBe(true);
  });
});

describe("sharing tips", () => {
  const staff = [{ userId: "a", name: "Asha", minutes: 600 }, { userId: "b", name: "Bimal", minutes: 300 }, { userId: "c", name: "Chhiring", minutes: 300 }, { userId: "d", name: "Off", minutes: 0 }];
  it("shares by hours worked, leaves out anyone who did not work, and adds up exactly", () => {
    const r = shareOut(100_000, staff, "HOURS");
    expect(r.map((x) => x.userId)).toEqual(["a", "b", "c"]);
    expect(r.map((x) => x.amount)).toEqual([50_000, 25_000, 25_000]);
    const odd = shareOut(100_001, staff, "HOURS");
    expect(odd.reduce((n, x) => n + x.amount, 0)).toBe(100_001);
  });
  it("shares equally when asked", () => {
    const r = shareOut(1_000, staff, "EQUAL");
    expect(r.map((x) => x.amount).sort()).toEqual([333, 333, 334]);
    expect(r.reduce((n, x) => n + x.amount, 0)).toBe(1_000);
  });
  it("gives nothing when there is nothing to share or nobody worked", () => {
    expect(shareOut(0, staff, "HOURS").every((x) => x.amount === 0)).toBe(true);
    expect(shareOut(500, [{ userId: "x", name: "X", minutes: 0 }], "HOURS")).toEqual([]);
  });
  it("is fair to the paisa across many people", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ userId: String(i), name: String(i), minutes: 100 + i * 13 }));
    for (const pool of [1, 6, 7, 999, 123_457]) expect(shareOut(pool, many, "HOURS").reduce((n, x) => n + x.amount, 0)).toBe(pool);
  });
});
