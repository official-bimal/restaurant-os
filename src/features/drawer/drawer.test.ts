import { describe, expect, it } from "vitest";
import { countTotal, difference, expectedCash, isMoneyIn, movesNet } from "./drawer";

describe("what the drawer should hold", () => {
  it("adds cash sales and cash put in, and takes off refunds and cash taken out", () => {
    const moves = [{ kind: "BANK_DEPOSIT" as const, amount: 300_000 }, { kind: "PETTY_EXPENSE" as const, amount: 20_000 }, { kind: "OWNER_ADDS" as const, amount: 50_000 }, { kind: "OTHER_IN" as const, amount: 10_000 }];
    expect(movesNet(moves)).toBe(-260_000);
    expect(expectedCash({ openingFloat: 500_000, cashSales: 800_000, cashRefunds: 40_000, moves, cashTips: 15_000 })).toBe(500_000 + 800_000 - 40_000 - 260_000 + 15_000);
  });
  it("is just the float when nothing happened", () => {
    expect(expectedCash({ openingFloat: 250_000, cashSales: 0, cashRefunds: 0, moves: [], cashTips: 0 })).toBe(250_000);
  });
  it("says which way a move went and how far off the count is", () => {
    expect(isMoneyIn("OWNER_ADDS")).toBe(true);
    expect(isMoneyIn("BANK_DEPOSIT")).toBe(false);
    expect(difference(99_000, 100_000)).toBe(-1_000);
    expect(difference(101_000, 100_000)).toBe(1_000);
  });
});

describe("counting by notes and coins", () => {
  it("adds up each denomination, in paisa", () => {
    expect(countTotal({ "500": 3, "100": 7, "5": 2 })).toBe((1_500 + 700 + 10) * 100);
    expect(countTotal({})).toBe(0);
  });
  it("refuses a made-up note or a bad count", () => {
    expect(() => countTotal({ "3": 1 })).toThrow(/Unknown/);
    expect(() => countTotal({ "100": -1 })).toThrow(/whole number/);
    expect(() => countTotal({ "100": 1.5 })).toThrow(/whole number/);
  });
});
