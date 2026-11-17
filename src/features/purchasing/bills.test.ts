import { describe, expect, it } from "vitest";
import { ageBucket, billStatus, daysBetween, outstanding, summarizePayables } from "./bills";

describe("bill status", () => {
  it("follows what has been paid", () => {
    expect(billStatus({ amount: 1_000, paid: 0, voided: false })).toBe("UNPAID");
    expect(billStatus({ amount: 1_000, paid: 400, voided: false })).toBe("PARTIAL");
    expect(billStatus({ amount: 1_000, paid: 1_000, voided: false })).toBe("PAID");
    expect(billStatus({ amount: 1_000, paid: 0, voided: true })).toBe("VOID");
  });
  it("shows what is still owed, and nothing on a voided bill", () => {
    expect(outstanding({ amount: 1_000, paid: 400, voided: false })).toBe(600);
    expect(outstanding({ amount: 1_000, paid: 1_500, voided: false })).toBe(0);
    expect(outstanding({ amount: 1_000, paid: 0, voided: true })).toBe(0);
  });
});

describe("lateness", () => {
  it("counts whole days across month ends and leap years", () => {
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2); // 2028 is a leap year
    expect(daysBetween("2026-03-10", "2026-03-10")).toBe(0);
    expect(daysBetween("2026-03-10", "2026-03-01")).toBe(-9);
  });
  it("puts a bill in a bucket by days past due", () => {
    const today = "2026-06-30";
    expect(ageBucket(null, today)).toBe("NOT_DUE");
    expect(ageBucket("2026-06-30", today)).toBe("NOT_DUE"); // due today is not late
    expect(ageBucket("2026-07-15", today)).toBe("NOT_DUE");
    expect(ageBucket("2026-06-29", today)).toBe("DAYS_1_30");
    expect(ageBucket("2026-05-31", today)).toBe("DAYS_1_30"); // 30 days
    expect(ageBucket("2026-05-30", today)).toBe("DAYS_31_60");
    expect(ageBucket("2026-05-01", today)).toBe("DAYS_31_60"); // exactly 60 days late
  });
  it("calls anything over 60 days over sixty", () => {
    expect(ageBucket("2026-04-30", "2026-06-30")).toBe("OVER_60"); // 61 days late
    expect(ageBucket("2026-04-01", "2026-06-30")).toBe("OVER_60"); // 90 days late
  });
});

describe("payables summary", () => {
  it("adds up what each supplier is owed and how late", () => {
    const rows = summarizePayables(
      [
        { supplierId: "a", amount: 10_000, paid: 2_000, voided: false, dueDate: "2026-06-01" }, // 29 days late, 8,000 left
        { supplierId: "a", amount: 5_000, paid: 0, voided: false, dueDate: "2026-07-20" }, //     not due
        { supplierId: "a", amount: 7_000, paid: 7_000, voided: false, dueDate: "2026-01-01" }, // paid: ignored
        { supplierId: "b", amount: 3_000, paid: 0, voided: false, dueDate: "2026-03-01" }, //     over 60 days late
        { supplierId: "b", amount: 9_000, paid: 0, voided: true, dueDate: "2026-03-01" }, //      voided: ignored
      ],
      "2026-06-30",
    );
    expect(rows.map((r) => r.supplierId)).toEqual(["a", "b"]); // largest balance first
    expect(rows[0]).toMatchObject({ outstanding: 13_000, overdue: 8_000 });
    expect(rows[0]!.buckets).toEqual({ NOT_DUE: 5_000, DAYS_1_30: 8_000, DAYS_31_60: 0, OVER_60: 0 });
    expect(rows[1]).toMatchObject({ outstanding: 3_000, overdue: 3_000 });
    expect(rows[1]!.buckets.OVER_60).toBe(3_000);
  });
});
