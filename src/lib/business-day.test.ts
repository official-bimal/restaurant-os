import { describe, expect, it } from "vitest";
import { addDays, dayRange, isValidDate, localDate } from "./business-day";

const KTM = "Asia/Kathmandu"; // UTC+5:45, no daylight saving
const NY = "America/New_York";

describe("isValidDate", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isValidDate("2026-11-16")).toBe(true);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2027-02-29")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-1-1")).toBe(false);
    expect(isValidDate("not a date")).toBe(false);
  });
});

describe("localDate", () => {
  it("uses the business's calendar, not UTC", () => {
    // 2 AM Kathmandu on the 16th is still the 15th in UTC (20:15Z on the 15th).
    expect(localDate(new Date("2026-11-15T20:15:00Z"), KTM)).toBe("2026-11-16");
    expect(localDate(new Date("2026-11-15T18:14:59Z"), KTM)).toBe("2026-11-15"); // one second before local midnight
    expect(localDate(new Date("2026-11-15T18:15:00Z"), KTM)).toBe("2026-11-16"); // local midnight
  });
});

describe("dayRange", () => {
  it("runs from local midnight to local midnight in UTC", () => {
    const { start, end } = dayRange("2026-11-16", KTM);
    expect(start.toISOString()).toBe("2026-11-15T18:15:00.000Z");
    expect(end.toISOString()).toBe("2026-11-16T18:15:00.000Z");
  });

  it("is consistent with localDate at both edges", () => {
    for (const date of ["2026-01-01", "2026-11-16", "2028-02-29", "2026-12-31"]) {
      const { start, end } = dayRange(date, KTM);
      expect(localDate(start, KTM)).toBe(date);
      expect(localDate(new Date(end.getTime() - 1), KTM)).toBe(date);
      expect(localDate(end, KTM)).toBe(addDays(date, 1));
    }
  });

  it("handles daylight saving: a 23-hour and a 25-hour day", () => {
    const spring = dayRange("2026-03-08", NY); // clocks jump forward
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23);
    const autumn = dayRange("2026-11-01", NY); // clocks fall back
    expect((autumn.end.getTime() - autumn.start.getTime()) / 3_600_000).toBe(25);
    const normal = dayRange("2026-06-10", NY);
    expect((normal.end.getTime() - normal.start.getTime()) / 3_600_000).toBe(24);
    expect(localDate(spring.start, NY)).toBe("2026-03-08");
    expect(localDate(new Date(spring.end.getTime() - 1), NY)).toBe("2026-03-08");
  });

  it("rejects invalid dates", () => {
    expect(() => dayRange("2026-02-30", KTM)).toThrow(RangeError);
  });
});

describe("addDays", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});
