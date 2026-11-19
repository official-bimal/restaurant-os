import { describe, expect, it } from "vitest";
import { bsText, fiscalYearOf, fiscalYearRange, fromBs, toBs } from "./fiscal";

describe("Bikram Sambat dates", () => {
  it("converts both ways", () => {
    expect(toBs("2026-07-17")).toEqual({ year: 2083, month: 4, day: 1 });
    expect(fromBs(2083, 4, 1)).toBe("2026-07-17");
    expect(bsText("2026-07-17")).toBe("2083-04-01");
  });
});

describe("fiscal year", () => {
  it("starts on 1 Shrawan and ends with Ashadh", () => {
    expect(fiscalYearOf("2026-07-17")).toBe("2083/84");
    expect(fiscalYearOf("2026-07-16")).toBe("2082/83");
    expect(fiscalYearOf("2027-01-01")).toBe("2083/84");
  });
  it("gives the range of a fiscal year", () => {
    const r = fiscalYearRange("2083/84");
    expect(r.from).toBe("2026-07-17");
    expect(fiscalYearOf(r.from)).toBe("2083/84");
    expect(fiscalYearOf(r.to)).toBe("2083/84");
    const after = new Date(Date.UTC(+r.to.slice(0, 4), +r.to.slice(5, 7) - 1, +r.to.slice(8, 10) + 1)).toISOString().slice(0, 10);
    expect(fiscalYearOf(after)).toBe("2084/85");
  });
});
