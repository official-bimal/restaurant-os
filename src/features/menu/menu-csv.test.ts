import { describe, expect, it } from "vitest";
import { menuToCsv, parseMenuCsv, planImport, summarize, type ExistingDish } from "./menu-csv";

describe("reading a menu file", () => {
  it("reads dishes with any column order and case, rupees in text and yes/no", () => {
    const r = parseMenuCsv("price,NAME,Category,available,Prep Minutes,Station,Nepali Name\r\n\"1,250.50\",Latte,Hot Coffee,No,5,Bar,ल्याटे\r\nRs 90,Egg (Boiled),Extra Topping,,,Kitchen,\r\n");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ name: "Latte", category: "Hot Coffee", price: 125_050, available: false, prepMinutes: 5, station: "Bar", nameNe: "ल्याटे" });
    expect(r.rows[1]).toMatchObject({ name: "Egg (Boiled)", price: 9_000, available: null, prepMinutes: null, nameNe: null });
  });
  it("reports each bad row with its line and still reads the good ones", () => {
    const r = parseMenuCsv("Name,Price,Category\nGood,100,A\n,50,A\nBadPrice,abc,A\nDup,10,A\nDup,12,A\nFree,0,A");
    expect(r.rows.map((x) => x.name)).toEqual(["Good", "Dup", "Free"]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 6]);
    expect(r.errors[0]!.message).toMatch(/no name/);
    expect(r.errors[1]!.message).toMatch(/price must be a number/);
    expect(r.errors[2]!.message).toMatch(/appears twice/);
  });
  it("refuses a file with no Name or Price column, and an empty file", () => {
    expect(parseMenuCsv("Dish,Cost\nA,1").errors[0]!.message).toMatch(/"Price"/);
    expect(parseMenuCsv("Price\n1").errors[0]!.message).toMatch(/"Name"/);
    expect(parseMenuCsv("").errors[0]!.message).toMatch(/empty/);
  });
  it("checks prep minutes and available", () => {
    const r = parseMenuCsv("Name,Price,Prep,Available\nA,1,0,\nB,1,5,maybe\nC,1,5,yes");
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
    expect(r.rows.map((x) => x.name)).toEqual(["C"]);
  });
});

const existing: ExistingDish[] = [
  { id: "1", name: "Latte", category: "Hot Coffee", nameNe: null, price: 20_000, station: "Bar", prepMinutes: 5, available: true },
  { id: "2", name: "Fries", category: "Snack", nameNe: null, price: 18_000, station: "Kitchen", prepMinutes: 10, available: true },
  { id: "3", name: "Tea", category: "Hot", nameNe: null, price: 5_000, station: null, prepMinutes: 4, available: true },
  { id: "4", name: "Tea", category: "Cold", nameNe: null, price: 6_000, station: null, prepMinutes: 4, available: true },
];
const rowOf = (over: Partial<ReturnType<typeof parseMenuCsv>["rows"][number]>): ReturnType<typeof parseMenuCsv>["rows"][number] => ({ line: 2, category: "Hot Coffee", name: "Latte", nameNe: null, price: 20_000, station: null, prepMinutes: 5, available: true, ...over });

describe("planning an import", () => {
  it("adds new dishes, updates changed ones with what changes, and leaves the same alone", () => {
    const plan = planImport(
      [rowOf({}), rowOf({ name: "Mocha", price: 24_000 }), rowOf({ name: "Fries", category: "Snack", price: 21_000, prepMinutes: 10, station: "Kitchen" })],
      existing,
    );
    expect(plan.map((p) => p.action)).toEqual(["SAME", "ADD", "UPDATE"]);
    expect(plan[2]!.changes).toEqual(["price Rs 180 to Rs 210"]);
    expect(summarize(plan)).toEqual({ add: 1, update: 1, same: 1 });
  });
  it("notices a dish that moved category, and does not guess when a name is in two categories", () => {
    const moved = planImport([rowOf({ name: "Fries", category: "Sides", price: 18_000, prepMinutes: 10 })], existing)[0]!;
    expect(moved.action).toBe("UPDATE");
    expect(moved.existingId).toBe("2");
    expect(moved.changes).toEqual(["category Snack to Sides"]);
    const ambiguous = planImport([rowOf({ name: "Tea", category: "Other", price: 5_000, prepMinutes: 4 })], existing)[0]!;
    expect(ambiguous.action).toBe("ADD");
    expect(planImport([rowOf({ name: "Tea", category: "Cold", price: 6_500, prepMinutes: 4 })], existing)[0]).toMatchObject({ action: "UPDATE", existingId: "4" });
  });
  it("keeps a dish where it is when the file gives no category, and sends a new one to Menu", () => {
    const parsed = parseMenuCsv("Name,Price\nLatte,200\nNewbie,50\n");
    expect(parsed.rows.map((r) => r.category)).toEqual([null, null]);
    const plan = planImport(parsed.rows, existing);
    expect(plan.map((p) => p.action)).toEqual(["SAME", "ADD"]);
  });
  it("only changes the Nepali name and station when the file gives one", () => {
    const keep = planImport([rowOf({ nameNe: null, station: null })], existing)[0]!;
    expect(keep.action).toBe("SAME");
    const set = planImport([rowOf({ nameNe: "ल्याटे", station: "Kitchen" })], existing)[0]!;
    expect(set.changes).toEqual(["Nepali name", "station Bar to Kitchen"]);
  });
  it("writes the menu out in the same columns it reads", () => {
    const csv = menuToCsv(existing);
    const back = parseMenuCsv(csv);
    expect(back.errors).toEqual([]);
    expect(back.rows).toHaveLength(4);
    expect(summarize(planImport(back.rows, existing))).toEqual({ add: 0, update: 0, same: 4 });
  });
});
