import { describe, expect, it } from "vitest";
import { cleanPrinterName, cleanPrinterWidth, cleanRoutes, printerForKind, seenText, splitKitchen, type RouteRow } from "./routing";
import { BILL_FIELDS, cleanFields, DEFAULT_FIELDS, fieldsFromForm, KOT_FIELDS } from "./slip-fields";
import { DEFAULT_LAYOUT, layoutKitchen, layoutReceipt, layoutTest } from "./layout";
import { SAMPLE_KITCHEN, SAMPLE_RECEIPT } from "./samples";

const K = (stationKey: string, printerId: string): RouteRow => ({ kind: "KITCHEN", stationKey, printerId });

describe("routing kitchen slips by station", () => {
  it("sends everything to one unnamed printer when there are no kitchen routes", () => {
    expect(splitKitchen([], ["bar", "grill"])).toEqual([{ printerId: null, keys: [] }]);
    expect(splitKitchen([{ kind: "RECEIPT", stationKey: "", printerId: "p1" }], ["bar"])).toEqual([{ printerId: null, keys: [] }]);
  });
  it("sends a station to its own printer and the rest to the kitchen default", () => {
    const routes = [K("", "kitchen"), K("bar", "barprinter")];
    expect(splitKitchen(routes, ["bar", "grill", ""])).toEqual([
      { printerId: "barprinter", keys: ["bar"] },
      { printerId: "kitchen", keys: ["grill", ""] },
    ]);
  });
  it("makes one slip when every station goes to the same place", () => {
    expect(splitKitchen([K("", "kitchen")], ["bar", "grill"])).toEqual([{ printerId: "kitchen", keys: ["bar", "grill"] }]);
  });
  it("leaves stations with no route and no default for the unnamed printer", () => {
    expect(splitKitchen([K("bar", "barprinter")], ["bar", "grill"])).toEqual([
      { printerId: "barprinter", keys: ["bar"] },
      { printerId: null, keys: ["grill"] },
    ]);
  });
  it("never repeats a station", () => {
    expect(splitKitchen([K("", "k")], ["a", "a", "b"])[0]!.keys).toEqual(["a", "b"]);
  });
  it("finds the printer for bills and credit notes", () => {
    const r: RouteRow[] = [{ kind: "RECEIPT", stationKey: "", printerId: "counter" }, K("bar", "x")];
    expect(printerForKind(r, "RECEIPT")).toBe("counter");
    expect(printerForKind(r, "CREDIT_NOTE")).toBeNull();
  });
});

describe("checking posted routes", () => {
  const printers = new Set(["p1", "p2"]);
  const stations = new Set(["bar"]);
  it("keeps real routes and drops empty ones", () => {
    const r = cleanRoutes([{ kind: "KITCHEN", stationKey: "", printerId: "p1" }, { kind: "RECEIPT", stationKey: "", printerId: "" }, { kind: "KITCHEN", stationKey: "bar", printerId: "p2" }], printers, stations);
    expect(r).toEqual([K("", "p1"), K("bar", "p2")]);
  });
  it("refuses another branch's printer, unknown stations and station routes for bills", () => {
    expect(() => cleanRoutes([{ kind: "KITCHEN", stationKey: "", printerId: "other" }], printers, stations)).toThrow(/this branch/);
    expect(() => cleanRoutes([{ kind: "KITCHEN", stationKey: "nope", printerId: "p1" }], printers, stations)).toThrow(/station/);
    expect(() => cleanRoutes([{ kind: "RECEIPT", stationKey: "bar", printerId: "p1" }], printers, stations)).toThrow(/Only kitchen/);
    expect(() => cleanRoutes([{ kind: "WHATEVER", stationKey: "", printerId: "p1" }], printers, stations)).toThrow(/not known/);
  });
  it("tidies printer names and widths", () => {
    expect(cleanPrinterName("  Bar   printer ")).toBe("Bar printer");
    expect(() => cleanPrinterName("  ")).toThrow(/name/);
    expect(() => cleanPrinterName("x".repeat(41))).toThrow(/name/);
    expect(cleanPrinterWidth("")).toBeNull();
    expect(cleanPrinterWidth("58")).toBe(58);
    expect(() => cleanPrinterWidth("20")).toThrow(/40 to 300/);
    expect(() => cleanPrinterWidth("58.5")).toThrow(/40 to 300/);
  });
  it("says in words whether a printer is connected", () => {
    const now = new Date("2026-12-01T10:00:00Z");
    expect(seenText(null, now)).toEqual({ text: "No printer program has connected yet", online: false });
    expect(seenText(new Date("2026-12-01T09:59:45Z"), now)).toEqual({ text: "Connected", online: true });
    expect(seenText(new Date("2026-12-01T09:59:00Z"), now).online).toBe(false);
    expect(seenText(new Date("2026-12-01T09:50:00Z"), now).text).toBe("Last seen 10 minutes ago");
    expect(seenText(new Date("2026-12-01T05:00:00Z"), now).text).toBe("Last seen 5 hours ago");
  });
});

describe("slip field choices", () => {
  it("start with everything the slips always had, and the extras off", () => {
    expect(DEFAULT_FIELDS.kot.waiter).toBe(false);
    expect(DEFAULT_FIELDS.kot.itemCount).toBe(false);
    for (const f of [...KOT_FIELDS, ...BILL_FIELDS]) expect(f.label.length).toBeGreaterThan(3);
    expect(Object.values(DEFAULT_FIELDS.bill).every(Boolean)).toBe(true);
  });
  it("read a saved value safely", () => {
    expect(cleanFields(null)).toEqual(DEFAULT_FIELDS);
    expect(cleanFields("x")).toEqual(DEFAULT_FIELDS);
    const c = cleanFields({ kot: { time: false, waiter: "yes", junk: true }, bill: { payments: false } });
    expect(c.kot.time).toBe(false);
    expect(c.kot.waiter).toBe(false); // not a true/false: the usual setting
    expect(c.kot.table).toBe(true);
    expect(c.bill.payments).toBe(false);
    expect("junk" in c.kot).toBe(false);
  });
  it("read the posted form, where an unticked box is off", () => {
    const f = fieldsFromForm((n) => n === "kot.table" || n === "bill.payments");
    expect(f.kot.table).toBe(true);
    expect(f.kot.time).toBe(false);
    expect(f.bill.payments).toBe(true);
    expect(f.bill.bsDate).toBe(false);
  });
});

describe("the slips follow the field choices", () => {
  const kitchen = (over: Partial<typeof DEFAULT_FIELDS.kot>, data = SAMPLE_KITCHEN) =>
    layoutKitchen(data, { ...DEFAULT_LAYOUT, fields: { ...DEFAULT_FIELDS, kot: { ...DEFAULT_FIELDS.kot, ...over } } }, 40).map((l) => l.text).join("\n");
  const bill = (over: Partial<typeof DEFAULT_FIELDS.bill>) => layoutReceipt(SAMPLE_RECEIPT, { ...DEFAULT_LAYOUT, fields: { ...DEFAULT_FIELDS, bill: { ...DEFAULT_FIELDS.bill, ...over } } }, 40).map((l) => l.text).join("\n");

  it("a kitchen slip is unchanged with the usual settings", () => {
    const t = kitchen({});
    for (const s of ["Table 4 #217", "Main branch - 12:29", "NOTE: Allergy: no nuts", "GRILL", "2 x Buff Momo", "+ Cheese", "** extra spicy **", "BAR", "** no sugar **"]) expect(t).toContain(s);
    expect(t).not.toContain("Taken by");
    expect(t).not.toContain("Items:");
  });
  it("hides and shows each kitchen field", () => {
    expect(kitchen({ waiter: true })).toContain("Taken by Ram");
    expect(kitchen({ itemCount: true })).toContain("Items: 4");
    expect(kitchen({ orderNumber: false })).not.toContain("#217");
    expect(kitchen({ table: false })).not.toContain("Table 4");
    expect(kitchen({ table: false, orderNumber: false })).toContain("ORDER");
    expect(kitchen({ time: false })).not.toContain("12:29");
    expect(kitchen({ branch: false })).not.toContain("Main branch");
    expect(kitchen({ branch: false, time: false })).not.toContain(" - ");
    expect(kitchen({ orderNote: false })).not.toContain("Allergy");
    expect(kitchen({ station: false })).not.toContain("GRILL");
    expect(kitchen({ itemNote: false })).not.toContain("extra spicy");
    expect(kitchen({ addOns: false })).not.toContain("Cheese");
    // Dishes and quantities always print.
    expect(kitchen({ station: false, itemNote: false, addOns: false, orderNote: false })).toContain("2 x Buff Momo");
  });
  it("does not print who took the order when it is not known", () => {
    expect(kitchen({ waiter: true }, { ...SAMPLE_KITCHEN, waiter: null })).not.toContain("Taken by");
  });
  it("hides and shows each bill field but never the legal parts", () => {
    const usual = bill({});
    for (const s of ["Order #217", "Table 4", "Miti: 2083-08-01 BS", "+ Cheese", "(extra spicy)", "Paid by cash"]) expect(usual).toContain(s);
    expect(bill({ orderNumber: false })).not.toContain("Order #");
    expect(bill({ table: false })).not.toContain("Table 4");
    expect(bill({ bsDate: false })).not.toContain("Miti:");
    expect(bill({ itemDetails: false })).not.toContain("Cheese");
    expect(bill({ payments: false })).not.toContain("Paid by");
    const bare = bill({ orderNumber: false, table: false, bsDate: false, itemDetails: false, payments: false });
    for (const s of ["TAX INVOICE", "Invoice #1042", "PAN: 123456789", "Buff Momo", "VAT", "TOTAL"]) expect(bare).toContain(s);
  });
  it("keeps saying Offline sale for a bill made with no connection", () => {
    const t = layoutReceipt({ ...SAMPLE_RECEIPT, orderNumber: null }, { ...DEFAULT_LAYOUT, fields: { ...DEFAULT_FIELDS, bill: { ...DEFAULT_FIELDS.bill, orderNumber: false } } }, 40).map((l) => l.text).join("\n");
    expect(t).toContain("Offline sale");
  });
  it("makes a test page as wide as the paper", () => {
    const lines = layoutTest({ printer: "Bar printer", branch: "Main", when: "now", paperMm: 58 }, 32);
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toContain("Bar printer");
    expect(text).toContain("Paper 58 mm, 32 characters");
    expect(lines.find((l) => /^1234567890/.test(l.text))!.text).toHaveLength(32);
  });
});
