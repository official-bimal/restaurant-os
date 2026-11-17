import { describe, expect, it } from "vitest";
import { formatMinute, localParts, parseTime, pickActiveSet, type ScheduleRow } from "./menu-sets";

const sched: ScheduleRow[] = [
  { menuSetId: "breakfast", dayOfWeek: 1, startMinute: 6 * 60, endMinute: 11 * 60 },
  { menuSetId: "lunch", dayOfWeek: 1, startMinute: 11 * 60, endMinute: 16 * 60 },
];

describe("pickActiveSet", () => {
  it("follows the schedule, with the end time exclusive", () => {
    expect(pickActiveSet(null, sched, { dayOfWeek: 1, minute: 6 * 60 })).toBe("breakfast");
    expect(pickActiveSet(null, sched, { dayOfWeek: 1, minute: 11 * 60 - 1 })).toBe("breakfast");
    expect(pickActiveSet(null, sched, { dayOfWeek: 1, minute: 11 * 60 })).toBe("lunch");
  });
  it("shows the whole menu when nothing applies", () => {
    expect(pickActiveSet(null, sched, { dayOfWeek: 2, minute: 9 * 60 })).toBeNull();
    expect(pickActiveSet(null, sched, { dayOfWeek: 1, minute: 20 * 60 })).toBeNull();
  });
  it("lets a hand-picked set win over the schedule", () => {
    expect(pickActiveSet("special", sched, { dayOfWeek: 1, minute: 9 * 60 })).toBe("special");
  });
});

describe("localParts", () => {
  it("reads the weekday and time in the business's own zone", () => {
    // 2026-11-16 is a Monday. 03:00 UTC is 08:45 in Kathmandu (UTC+5:45).
    expect(localParts(new Date("2026-11-16T03:00:00Z"), "Asia/Kathmandu")).toEqual({ dayOfWeek: 1, minute: 8 * 60 + 45 });
    // 20:00 UTC on Monday is already Tuesday 01:45 there.
    expect(localParts(new Date("2026-11-16T20:00:00Z"), "Asia/Kathmandu")).toEqual({ dayOfWeek: 2, minute: 1 * 60 + 45 });
  });
});

describe("times", () => {
  it("parses and formats", () => {
    expect(parseTime("07:30")).toBe(450);
    expect(parseTime("7:05")).toBe(425);
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("abc")).toBeNull();
    expect(formatMinute(450)).toBe("07:30");
  });
});
