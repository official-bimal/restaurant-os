import { describe, expect, it } from "vitest";
import { maskPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("turns local, spaced and international Nepal numbers into one E.164 form", () => {
    const e164 = "+9779812345678";
    expect(normalizePhone("9812345678")).toBe(e164);
    expect(normalizePhone("98 1234 5678")).toBe(e164);
    expect(normalizePhone("+977-9812345678")).toBe(e164);
    expect(normalizePhone("00977 9812345678")).toBe(e164);
  });

  it("accepts valid foreign numbers", () => {
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
  });

  it("rejects junk, short numbers and empty input", () => {
    for (const bad of ["", "   ", "abc", "123", "98123", "+977 12", "9".repeat(40)]) {
      expect(() => normalizePhone(bad), bad).toThrow("valid phone");
    }
  });
});

describe("maskPhone", () => {
  it("keeps the country code, two leading and two trailing digits", () => {
    expect(maskPhone("+9779812345678")).toBe("+977 98••••••78");
  });
  it("never throws on garbage", () => {
    expect(maskPhone("garbage")).toBe("••••••");
  });
});
