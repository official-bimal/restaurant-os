import { describe, expect, it } from "vitest";
import { computePay, formatHours, isPeriod, minutesBetween, monthBounds, netPay, splitMinutes, sumAdjustments } from "./payroll";

const TZ = "Asia/Kathmandu"; // UTC+5:45
const at = (iso: string) => new Date(iso);

describe("splitMinutes", () => {
  it("counts minutes between clock in and out", () => {
    expect(minutesBetween(at("2026-06-01T03:00:00Z"), at("2026-06-01T11:30:00Z"))).toBe(510);
    expect(minutesBetween(at("2026-06-01T11:30:00Z"), at("2026-06-01T03:00:00Z"))).toBe(0); // never negative
  });

  it("pays overtime only beyond the daily limit, per day", () => {
    const r = splitMinutes(
      [
        { clockIn: at("2026-06-01T03:00:00Z"), clockOut: at("2026-06-01T12:00:00Z") }, // 9h on day 1: 8h + 1h over
        { clockIn: at("2026-06-02T03:00:00Z"), clockOut: at("2026-06-02T09:00:00Z") }, // 6h on day 2
      ],
      TZ,
      480,
    );
    expect(r).toEqual({ regular: 480 + 360, overtime: 60, total: 900 });
  });

  it("adds two shifts on the same local day together, and uses the business's own calendar day", () => {
    // 03:00-07:00 UTC and 08:00-13:00 UTC are both 2 June in Kathmandu: 4h + 5h = 9h
    const same = splitMinutes(
      [
        { clockIn: at("2026-06-02T03:00:00Z"), clockOut: at("2026-06-02T07:00:00Z") },
        { clockIn: at("2026-06-02T08:00:00Z"), clockOut: at("2026-06-02T13:00:00Z") },
      ],
      TZ,
      480,
    );
    expect(same.overtime).toBe(60);
    // 20:00 UTC on 1 June is already 2 June 01:45 in Kathmandu: it belongs to 2 June, not 1 June
    const late = splitMinutes(
      [
        { clockIn: at("2026-06-01T03:00:00Z"), clockOut: at("2026-06-01T09:00:00Z") }, // 1 June, 6h
        { clockIn: at("2026-06-01T20:00:00Z"), clockOut: at("2026-06-02T03:00:00Z") }, // 2 June, 7h
      ],
      TZ,
      480,
    );
    expect(late).toEqual({ regular: 360 + 420, overtime: 0, total: 780 });
  });
});

describe("computePay", () => {
  it("hourly: regular at the rate and overtime at the multiple, rounded to the paisa", () => {
    // Rs 100 an hour = 10,000 paisa
    const r = computePay({ payType: "HOURLY", rate: 10_000, overtimeBps: 15_000 }, { regular: 8 * 60, overtime: 90 });
    expect(r.basePay).toBe(80_000);
    expect(r.overtimePay).toBe(22_500); // 1.5 h x 10,000 x 1.5
    // an odd minute count rounds, not truncates
    expect(computePay({ payType: "HOURLY", rate: 10_000, overtimeBps: 15_000 }, { regular: 1, overtime: 0 }).basePay).toBe(167);
  });
  it("monthly is the fixed salary whatever the hours; none pays nothing", () => {
    expect(computePay({ payType: "MONTHLY", rate: 2_500_000, overtimeBps: 15_000 }, { regular: 100, overtime: 500 })).toEqual({ basePay: 2_500_000, overtimePay: 0 });
    expect(computePay({ payType: "NONE", rate: 5_000, overtimeBps: 15_000 }, { regular: 600, overtime: 0 })).toEqual({ basePay: 0, overtimePay: 0 });
  });
});

describe("adjustments and net", () => {
  it("adds allowances and bonuses, takes off advances and deductions", () => {
    const adj = sumAdjustments([
      { kind: "ALLOWANCE", amount: 100_000 },
      { kind: "BONUS", amount: 50_000 },
      { kind: "ADVANCE", amount: 300_000 },
      { kind: "DEDUCTION", amount: 20_000 },
    ]);
    expect(adj).toEqual({ additions: 150_000, deductions: 320_000 });
    expect(netPay({ basePay: 1_000_000, overtimePay: 50_000 }, adj)).toBe(880_000);
    // an advance larger than the pay shows as a negative net rather than being hidden
    expect(netPay({ basePay: 100_000, overtimePay: 0 }, { additions: 0, deductions: 250_000 })).toBe(-150_000);
  });
});

describe("periods", () => {
  it("knows month ends, including leap years", () => {
    expect(monthBounds("2026-06")).toEqual({ start: "2026-06-01", end: "2026-06-30" });
    expect(monthBounds("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthBounds("2026-12").end).toBe("2026-12-31");
  });
  it("checks a month and formats hours", () => {
    expect(isPeriod("2026-06")).toBe(true);
    for (const bad of ["2026-13", "2026-6", "26-06", "2026-00", "June"]) expect(isPeriod(bad)).toBe(false);
    expect(formatHours(510)).toBe("8h 30m");
    expect(formatHours(5)).toBe("0h 05m");
  });
});

import { parseLocalDateTime, toLocalInput } from "./payroll";

describe("local date and time boxes", () => {
  it("reads typed times in the business's own zone", () => {
    // 09:30 in Kathmandu (UTC+5:45) is 03:45 UTC
    expect(parseLocalDateTime("2026-06-01T09:30", "Asia/Kathmandu")!.toISOString()).toBe("2026-06-01T03:45:00.000Z");
    expect(parseLocalDateTime("2026-06-01T00:10", "Asia/Kathmandu")!.toISOString()).toBe("2026-05-31T18:25:00.000Z");
    expect(parseLocalDateTime("2026-01-15T12:00", "UTC")!.toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });
  it("round-trips, and refuses impossible dates", () => {
    const d = parseLocalDateTime("2026-06-01T09:30", "Asia/Kathmandu")!;
    expect(toLocalInput(d, "Asia/Kathmandu")).toBe("2026-06-01T09:30");
    for (const bad of ["2026-02-30T10:00", "2026-06-01T25:00", "2026-06-01 09:30", "", "nope"]) expect(parseLocalDateTime(bad, "UTC")).toBeNull();
  });
  it("handles a zone with daylight saving", () => {
    // New York is UTC-4 in July and UTC-5 in January
    expect(parseLocalDateTime("2026-07-01T12:00", "America/New_York")!.toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(parseLocalDateTime("2026-01-01T12:00", "America/New_York")!.toISOString()).toBe("2026-01-01T17:00:00.000Z");
  });
});
