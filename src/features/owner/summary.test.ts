import { describe, expect, it } from "vitest";
import { fullSummary, shortSummary, type SummaryData } from "./summary";

const data: SummaryData = {
  business: "Lakeside Cafe",
  dateLabel: "Tuesday 24 November",
  branches: ["Main", "Lakeside"],
  sales: { count: 63, gross: 5_200_000, average: 82_540, discount: 120_000, vat: 600_000 },
  refunds: { count: 1, total: 55_000 },
  net: 5_145_000,
  byMethod: { cash: 3_000_000, qr: 1_900_000, card: 245_000, credit: 0 },
  cancelled: { count: 2, amount: 90_000 },
  cash: [{ branch: "Main", difference: 0 }, { branch: "Lakeside", difference: -15_000 }],
  foodCost: 1_500_000,
  topItems: [{ name: "Buff Momo", quantity: 40 }],
  staff: [{ name: "Sita", minutes: 465, stillIn: false }, { name: "Ram", minutes: 120, stillIn: true }],
  staffOff: ["Anita"],
  alerts: [{ title: "Lakeside: cash short by Rs 150" }],
};

describe("summaries", () => {
  it("makes a short version for a text message", () => {
    const t = shortSummary(data);
    expect(t).toContain("Lakeside Cafe Tuesday 24 November");
    expect(t).toContain("Sales Rs 51,450 (63 bills)");
    expect(t).toContain("Refunds Rs 550");
    expect(t).toContain("Cancelled 2");
    expect(t).toContain("short Rs 150");
    expect(t).toContain("Staff 2 in, 1 off");
    expect(t).toContain("1 alert to check");
    expect(t.length).toBeLessThan(320);
  });
  it("leaves out what did not happen", () => {
    const quiet = shortSummary({ ...data, refunds: { count: 0, total: 0 }, cancelled: { count: 0, amount: 0 }, cash: [], alerts: [], sales: { ...data.sales, count: 1 } });
    expect(quiet).not.toMatch(/Refunds|Cancelled|alert/);
    expect(quiet).toContain("(1 bill)");
  });
  it("makes a full version with every section", () => {
    const t = fullSummary(data).join("\n");
    for (const s of ["SALES", "MONEY OUT", "CASH COUNT", "FOOD COST", "BEST SELLERS", "STAFF", "THINGS TO CHECK"]) expect(t).toContain(s);
    expect(t).toContain("Main · Lakeside".replace("Main · Lakeside", "Main, Lakeside"));
    expect(t).toContain("Main: matches");
    expect(t).toContain("Lakeside: short by Rs 150");
    expect(t).toContain("Ram: 2h 00m (still clocked in)");
    expect(t).toContain("Off / not in: Anita");
    expect(t).toContain("40 × Buff Momo");
  });
  it("says so when the day is not closed, nobody came or all is normal", () => {
    const t = fullSummary({ ...data, cash: [], staff: [], alerts: [], foodCost: 0, topItems: [] }).join("\n");
    expect(t).toContain("The day has not been closed yet.");
    expect(t).toContain("Nobody clocked in.");
    expect(t).toContain("Nothing unusual.");
    expect(t).not.toContain("FOOD COST");
  });

  it("adds food cost percent, low stock, bookings, deals and hukka when there is something to say", () => {
    const rich: SummaryData = {
      ...data,
      foodCostPercent: 31.5,
      lowStock: [{ name: "Milk", unit: "ml", left: 800 }, { name: "Beans", unit: "g", left: 0 }, { name: "Sugar", unit: "g", left: 1500 }, { name: "Ice", unit: "g", left: 10 }],
      tomorrowBookings: 3,
      deals: { bills: 4, saved: 120_000 },
      hukka: { started: 6, averageMinutes: 52, coils: 5 },
    };
    const short = shortSummary(rich);
    expect(short).toContain("Food cost 31.5%");
    expect(short).toContain("Low stock: Milk, Beans, Sugar +1");
    expect(short).toContain("3 bookings tomorrow");
    const full = fullSummary(rich).join("\n");
    expect(full).toContain("(31.5% of food sales)");
    expect(full).toContain("RUNNING LOW");
    expect(full).toContain("Milk: 800 ml left");
    expect(full).toContain("Beans: out");
    expect(full).toContain("Sugar: 1.5 kg left");
    expect(full).toContain("4 bills used a deal, Rs 1,200 off");
    expect(full).toContain("6 started, about 52 min each, 5 extra coils");
    expect(full).toContain("3 table bookings");
  });
  it("says nothing about the extras when there are none", () => {
    const t = fullSummary({ ...data, lowStock: [], tomorrowBookings: 0, deals: { bills: 0, saved: 0 }, hukka: { started: 0, averageMinutes: null, coils: 0 } }).join("\n");
    expect(t).not.toMatch(/RUNNING LOW|TOMORROW|DEALS|HUKKA/);
  });
});
