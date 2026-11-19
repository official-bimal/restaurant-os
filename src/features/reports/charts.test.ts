import { describe, expect, it } from "vitest";
import { dayBuckets, hourBuckets, localHour, methodSlices, niceMax, shortMoney, weekOverWeek } from "./charts";

const KTM = "Asia/Kathmandu";
const at = (iso: string) => new Date(iso);

describe("hours and days in the business's time zone", () => {
  it("reads the local hour", () => {
    expect(localHour(at("2026-11-19T06:00:00Z"), KTM)).toBe(11); // 11:45 in Kathmandu
    expect(localHour(at("2026-11-19T18:30:00Z"), KTM)).toBe(0); // 00:15 the next day
  });
  it("sums sales by hour for one day only, refunds taking away", () => {
    const events = [
      { at: at("2026-11-19T06:00:00Z"), amount: 10_000 }, // 11:45 on the 19th
      { at: at("2026-11-19T06:10:00Z"), amount: 5_000 },
      { at: at("2026-11-19T06:14:00Z"), amount: -2_000 },
      { at: at("2026-11-18T06:00:00Z"), amount: 99_000 }, // another day
      { at: at("2026-11-19T18:30:00Z"), amount: 7_000 }, // 00:15 on the 20th: not the 19th
    ];
    const h = hourBuckets(events, KTM, "2026-11-19");
    expect(h).toHaveLength(24);
    expect(h[11]).toBe(13_000);
    expect(h.reduce((n, v) => n + v, 0)).toBe(13_000);
  });
  it("sums by day over a run of days, oldest first, with empty days at zero", () => {
    const events = [
      { at: at("2026-11-19T06:00:00Z"), amount: 3_000 },
      { at: at("2026-11-17T06:00:00Z"), amount: 1_000 },
      { at: at("2026-11-01T06:00:00Z"), amount: 500 }, // outside the window
    ];
    const d = dayBuckets(events, KTM, "2026-11-19", 4);
    expect(d.map((p) => p.date)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(d.map((p) => p.amount)).toEqual([0, 1_000, 0, 3_000]);
  });
});

describe("week over week", () => {
  const days = Array.from({ length: 14 }, (_, i) => ({ date: `d${i}`, amount: i < 7 ? 1_000 : 1_500 }));
  it("compares the last 7 days with the 7 before", () => {
    const w = weekOverWeek(days);
    expect(w.thisTotal).toBe(10_500);
    expect(w.lastTotal).toBe(7_000);
    expect(w.changePercent).toBe(50);
    expect(w.thisWeek).toHaveLength(7);
    expect(w.lastWeek[0]!.date).toBe("d0");
  });
  it("has no percentage when last week had no sales", () => {
    expect(weekOverWeek(days.map((d, i) => ({ ...d, amount: i < 7 ? 0 : 500 }))).changePercent).toBeNull();
  });
});

describe("payment methods", () => {
  it("gives each method's share, biggest first, and skips unused ones", () => {
    const s = methodSlices([{ method: "CASH", amount: 6_000 }, { method: "QR", amount: 3_000 }, { method: "CASH", amount: 1_000 }, { method: "CARD", amount: 0 }]);
    expect(s.map((x) => x.label)).toEqual(["Cash", "QR"]);
    expect(s.map((x) => x.percent)).toEqual([70, 30]);
    expect(methodSlices([])).toEqual([]);
  });
});

describe("axis labels", () => {
  it("writes short money and picks a tidy top", () => {
    expect(shortMoney(95_000)).toBe("Rs 950");
    expect(shortMoney(1_250_000)).toBe("Rs 12.5k");
    expect(shortMoney(32_000_000)).toBe("Rs 3.2L");
    expect(shortMoney(0)).toBe("Rs 0");
    expect(niceMax(0)).toBe(100);
    expect(niceMax(730)).toBe(1_000);
    expect(niceMax(1_200)).toBe(2_000);
    expect(niceMax(2_300)).toBe(2_500);
    expect(niceMax(4_100)).toBe(5_000);
  });
});
