import { describe, expect, it } from "vitest";
import { canTransitionItem, deriveOrderStatus, ticketAge } from "./status";

describe("item transitions", () => {
  it("allows the normal kitchen flow", () => {
    expect(canTransitionItem("PENDING", "PREPARING")).toBe(true);
    expect(canTransitionItem("PREPARING", "READY")).toBe(true);
    expect(canTransitionItem("READY", "SERVED")).toBe(true);
  });

  it("does not allow serving before ready, or changing a finished item", () => {
    expect(canTransitionItem("PENDING", "SERVED")).toBe(false);
    expect(canTransitionItem("SERVED", "PREPARING")).toBe(false);
    expect(canTransitionItem("CANCELLED", "PENDING")).toBe(false);
  });
});

describe("deriveOrderStatus", () => {
  const flags = { settled: false, cancelled: false };

  it("is OPEN while any active item is not served", () => {
    expect(deriveOrderStatus([{ status: "SERVED" }, { status: "PREPARING" }], flags)).toBe("OPEN");
  });

  it("is SERVED when every active item is served, ignoring cancelled items", () => {
    expect(deriveOrderStatus([{ status: "SERVED" }, { status: "CANCELLED" }], flags)).toBe("SERVED");
  });

  it("stays OPEN with no items or only cancelled items", () => {
    expect(deriveOrderStatus([], flags)).toBe("OPEN");
    expect(deriveOrderStatus([{ status: "CANCELLED" }], flags)).toBe("OPEN");
  });

  it("settlement and cancellation override items", () => {
    expect(deriveOrderStatus([{ status: "PENDING" }], { settled: true, cancelled: false })).toBe("PAID");
    expect(deriveOrderStatus([{ status: "SERVED" }], { settled: false, cancelled: true })).toBe("CANCELLED");
  });
});

describe("ticketAge", () => {
  it("goes fresh, warning, late around the target", () => {
    expect(ticketAge(5, 20)).toBe("FRESH");
    expect(ticketAge(15, 20)).toBe("WARNING");
    expect(ticketAge(20, 20)).toBe("LATE");
  });
});
