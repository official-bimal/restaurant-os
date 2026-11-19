import { describe, expect, it } from "vitest";
import { clockText, hukkaState, isCoilDish, isHukkaCategory, minutesSince } from "./hukka";

describe("hukka timing", () => {
  it("recognises hukka categories and the coil dish", () => {
    expect(isHukkaCategory("Hukka (Shisha)")).toBe(true);
    expect(isHukkaCategory("Hookah")).toBe(true);
    expect(isHukkaCategory("Hot Coffee")).toBe(false);
    expect(isCoilDish("Extra Coil")).toBe(true);
    expect(isCoilDish("Hukka Mint")).toBe(false);
  });
  it("counts whole minutes and never goes negative", () => {
    expect(minutesSince(new Date("2026-11-19T10:00:00Z"), new Date("2026-11-19T10:45:59Z"))).toBe(45);
    expect(minutesSince(new Date("2026-11-19T10:00:00Z"), new Date("2026-11-19T09:00:00Z"))).toBe(0);
  });
  it("flags a hukka running long, and one about to", () => {
    expect(hukkaState(10, 60)).toBe("FRESH");
    expect(hukkaState(54, 60)).toBe("LATE_SOON");
    expect(hukkaState(60, 60)).toBe("RUNNING_LONG");
    expect(hukkaState(200, 60)).toBe("RUNNING_LONG");
  });
  it("writes time in words", () => {
    expect(clockText(45)).toBe("45 min");
    expect(clockText(75)).toBe("1 h 15 min");
  });
});
