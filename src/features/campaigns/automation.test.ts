import { describe, expect, it } from "vitest";
import { autoKey, inSendWindow, isBirthdayOn, isValidBirthday, localHour, RULE_INFO, RULE_KINDS } from "./automation";
import { validateTemplate } from "./segments";

describe("isValidBirthday", () => {
  it("accepts real month/day pairs, including 29 February", () => {
    expect(isValidBirthday(1, 31)).toBe(true);
    expect(isValidBirthday(2, 29)).toBe(true);
    expect(isValidBirthday(12, 1)).toBe(true);
  });
  it("refuses impossible or non-integer values", () => {
    for (const [m, d] of [[2, 30], [4, 31], [0, 5], [13, 1], [5, 0], [5, 32], [1.5, 3], ["1", 3], [null, null]] as const) {
      expect(isValidBirthday(m, d)).toBe(false);
    }
  });
});

describe("isBirthdayOn", () => {
  it("matches the month and day, not the year", () => {
    expect(isBirthdayOn(11, 24, "2026-11-24")).toBe(true);
    expect(isBirthdayOn(11, 24, "2031-11-24")).toBe(true);
    expect(isBirthdayOn(11, 24, "2026-11-25")).toBe(false);
    expect(isBirthdayOn(11, 24, "2026-12-24")).toBe(false);
  });
  it("marks a 29 February birthday on 28 February in a year without one", () => {
    expect(isBirthdayOn(2, 29, "2028-02-29")).toBe(true);
    expect(isBirthdayOn(2, 29, "2028-02-28")).toBe(false);
    expect(isBirthdayOn(2, 29, "2027-02-28")).toBe(true);
    expect(isBirthdayOn(2, 29, "2027-03-01")).toBe(false);
  });
  it("is never true without a birthday", () => {
    expect(isBirthdayOn(null, null, "2026-11-24")).toBe(false);
    expect(isBirthdayOn(11, null, "2026-11-24")).toBe(false);
    expect(isBirthdayOn(2, 30, "2026-02-28")).toBe(false);
  });
});

describe("sending window and keys", () => {
  it("only allows 9am to before 8pm", () => {
    expect([8, 9, 12, 19, 20, 23, 0].map(inSendWindow)).toEqual([false, true, true, true, false, false, false]);
  });
  it("reads the local hour in the business's time zone", () => {
    const noonUtc = new Date("2026-11-24T12:00:00Z");
    expect(localHour(noonUtc, "UTC")).toBe(12);
    expect(localHour(noonUtc, "Asia/Kathmandu")).toBe(17); // +5:45
    expect(localHour(new Date("2026-11-24T18:30:00Z"), "Asia/Kathmandu")).toBe(0); // midnight shows as 0, not 24
  });
  it("makes one key per rule per day", () => {
    expect(autoKey("BIRTHDAY", "2026-11-24")).toBe("BIRTHDAY:2026-11-24");
    expect(autoKey("WIN_BACK", "2026-11-24")).not.toBe(autoKey("BIRTHDAY", "2026-11-24"));
  });
});

describe("default rule texts", () => {
  it("are valid message templates", () => {
    for (const k of RULE_KINDS) expect(() => validateTemplate(RULE_INFO[k].template)).not.toThrow();
  });
});
