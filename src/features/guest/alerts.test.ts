import { describe, expect, it } from "vitest";
import { isLate, lateTitle, requestTitle, ringAlerts, rings, sortRequests, waitedMinutes, waitedText } from "./alerts";

const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);
const min = (n: number) => t0 + n * 60_000;

describe("guest request alerts", () => {
  it("counts whole minutes waited and never goes below zero", () => {
    expect(waitedMinutes(t0, min(0))).toBe(0);
    expect(waitedMinutes(t0, t0 + 59_999)).toBe(0);
    expect(waitedMinutes(t0, min(3))).toBe(3);
    expect(waitedMinutes(min(5), t0)).toBe(0);
    expect(waitedText(0)).toBe("just now");
    expect(waitedText(4)).toBe("4 min");
  });

  it("says when a request is late, by kind", () => {
    expect(isLate("REQUEST_BILL", t0, min(1))).toBe(false);
    expect(isLate("REQUEST_BILL", t0, min(2))).toBe(true);
    expect(isLate("CALL_WAITER", t0, min(2))).toBe(true);
    expect(isLate("WATER", t0, min(4))).toBe(false);
    expect(isLate("WATER", t0, min(5))).toBe(true);
  });

  it("words the alerts", () => {
    expect(requestTitle("REQUEST_BILL", "T3")).toBe("Table T3 wants the bill");
    expect(requestTitle("CALL_WAITER", "T3")).toBe("Table T3 is calling the waiter");
    expect(lateTitle("REQUEST_BILL", "T3", 4)).toBe("Table T3 has waited 4 min for the bill");
    expect(rings("WATER")).toBe(false);
    expect(rings("REQUEST_BILL")).toBe(true);
  });

  it("puts the bill first, then the waiter, then water, longest wait first", () => {
    const sorted = sortRequests([
      { id: "w", kind: "WATER" as const, createdAt: min(0) },
      { id: "c2", kind: "CALL_WAITER" as const, createdAt: min(2) },
      { id: "b2", kind: "REQUEST_BILL" as const, createdAt: min(3) },
      { id: "c1", kind: "CALL_WAITER" as const, createdAt: min(1) },
      { id: "b1", kind: "REQUEST_BILL" as const, createdAt: min(2) },
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["b1", "b2", "c1", "c2", "w"]);
  });

  it("rings once for a new request, again when it is late, and never for water", () => {
    const reqs = [
      { id: "a", kind: "REQUEST_BILL" as const, tableLabel: "T1", createdAt: min(0) },
      { id: "b", kind: "WATER" as const, tableLabel: "T2", createdAt: min(0) },
    ];
    expect(ringAlerts(reqs, min(1)).map((a) => a.id)).toEqual(["req-a"]);
    const later = ringAlerts(reqs, min(3));
    expect(later.map((a) => a.id)).toEqual(["req-a", "req-a-late"]);
    expect(later[1]!.title).toBe("Table T1 has waited 3 min for the bill");
  });
});
