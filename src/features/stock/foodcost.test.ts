import { describe, expect, it } from "vitest";
import { analyse, foodCostPercent, suggestedPrice, withoutVat } from "./foodcost";

const sale = (name: string, quantity: number, price: number, unitCost: number | null) => ({ menuItemId: name, name, quantity, revenue: quantity * price, unitCost });

describe("menu engineering", () => {
  const rows = analyse([
    sale("Momo", 100, 25_000, 8_000), // sells a lot, earns 17,000 each
    sale("Thali", 90, 40_000, 30_000), // sells a lot, earns 10,000 each
    sale("Steak", 8, 90_000, 30_000), // sells little, earns 60,000 each
    sale("Soup", 6, 12_000, 10_000), // sells little, earns 2,000 each
    sale("Special", 5, 20_000, null),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  it("sorts dishes into star, plowhorse, puzzle and dog", () => {
    expect(by.Momo!.klass).toBe("STAR");
    expect(by.Thali!.klass).toBe("PLOWHORSE");
    expect(by.Steak!.klass).toBe("PUZZLE");
    expect(by.Soup!.klass).toBe("DOG");
  });
  it("cannot judge a dish with no recipe", () => {
    expect(by.Special).toMatchObject({ klass: "NO_RECIPE", cost: null, profit: null, costPercent: null });
  });
  it("works out cost, profit and cost percent", () => {
    expect(by.Momo).toMatchObject({ cost: 800_000, profit: 1_700_000, costPercent: 32, profitEach: 17_000 });
  });
  it("copes with nothing sold", () => {
    expect(analyse([])).toEqual([]);
    expect(analyse([sale("A", 0, 100, 50)])[0]!.klass).toBe("DOG");
  });
});

describe("pricing", () => {
  it("suggests the price that reaches a target food cost, rounded up to Rs 5", () => {
    expect(suggestedPrice(8_000, 30)).toBe(27_000); // 26,667 -> 27,000
    expect(suggestedPrice(0, 30)).toBe(0);
    expect(suggestedPrice(8_000, 0)).toBe(0);
    expect(suggestedPrice(8_000, 100)).toBe(0);
  });
  it("food cost percent", () => {
    expect(foodCostPercent(3_000, 10_000)).toBe(30);
    expect(foodCostPercent(3_000, 0)).toBeNull();
  });
  it("takes VAT out of an inclusive price", () => {
    expect(withoutVat(11_300, 1_300, true)).toBe(10_000);
    expect(withoutVat(11_300, 1_300, false)).toBe(11_300);
  });
});
