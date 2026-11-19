/**
 * The menu as a spreadsheet: reading a CSV of dishes into a plan of what would be added, changed or left alone. Pure functions, no I/O.
 * Columns (any order, any case): Category, Name, Nepali name, Price, Station, Prep minutes, Available.
 */
import { parseCsv, toCsv, rupees } from "@/lib/csv";

export const MAX_ROWS = 1000;

export interface ImportRow {
  /** The line in the file, counting the header as line 1. */
  line: number;
  /** Null when the file gives none: a new dish goes to "Menu" and an existing dish stays where it is. */
  category: string | null;
  name: string;
  nameNe: string | null;
  /** Paisa. */
  price: number;
  station: string | null;
  /** Null when the file gives none: a new dish gets 15 and an existing dish keeps its own. */
  prepMinutes: number | null;
  /** Null when the file gives none: a new dish is available and an existing dish stays as it is. */
  available: boolean | null;
}

export interface ParsedMenu {
  rows: ImportRow[];
  errors: { line: number; message: string }[];
}

const HEADERS: Record<string, string> = {
  category: "category",
  name: "name",
  dish: "name",
  item: "name",
  "nepali name": "nameNe",
  nepali: "nameNe",
  namene: "nameNe",
  price: "price",
  "price (rs)": "price",
  rate: "price",
  station: "station",
  "prep minutes": "prep",
  prep: "prep",
  "prep time": "prep",
  available: "available",
};

const YES = new Set(["yes", "y", "true", "1", "available", "on"]);
const NO = new Set(["no", "n", "false", "0", "hidden", "off", "unavailable"]);

function clean(v: string | undefined): string {
  return (v ?? "").trim().replace(/\s+/g, " ");
}

/** Reads the file. A wrong row is reported with its line and left out; the rest still import. */
export function parseMenuCsv(text: string): ParsedMenu {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: [{ line: 1, message: "The file is empty." }] };
  const header = table[0]!.map((h) => HEADERS[clean(h).toLowerCase()] ?? "");
  for (const need of ["name", "price"]) if (!header.includes(need)) return { rows: [], errors: [{ line: 1, message: `The first row must name the columns, and one of them must be "${need === "name" ? "Name" : "Price"}".` }] };
  if (table.length - 1 > MAX_ROWS) return { rows: [], errors: [{ line: 1, message: `That is more than ${MAX_ROWS} dishes. Split the file.` }] };
  const col = (r: string[], key: string) => {
    const i = header.indexOf(key);
    return i >= 0 ? r[i] : undefined;
  };
  const rows: ImportRow[] = [];
  const errors: ParsedMenu["errors"] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const name = clean(col(r, "name"));
    const category = clean(col(r, "category")) || null;
    const rawPrice = clean(col(r, "price")).replace(/^rs\.?\s*/i, "").replace(/,/g, "");
    const fail = (message: string) => errors.push({ line, message });
    if (!name) return fail("The dish has no name.");
    if (name.length > 80) return fail(`"${name.slice(0, 20)}…" is too long (80 characters at most).`);
    if (category && category.length > 40) return fail(`${name}: the category name is too long (40 characters at most).`);
    if (!/^\d+(\.\d{1,2})?$/.test(rawPrice)) return fail(`${name}: the price must be a number like 250 or 250.50.`);
    const price = Math.round(Number(rawPrice) * 100);
    if (price > 100_000_000) return fail(`${name}: that price is too high.`);
    const prepRaw = clean(col(r, "prep"));
    const prep = prepRaw ? Number(prepRaw) : null;
    if (prep !== null && (!Number.isInteger(prep) || prep < 1 || prep > 240)) return fail(`${name}: prep minutes must be a whole number from 1 to 240.`);
    const avRaw = clean(col(r, "available")).toLowerCase();
    if (avRaw && !YES.has(avRaw) && !NO.has(avRaw)) return fail(`${name}: "available" must be yes or no.`);
    const key = `${(category ?? "").toLowerCase()}|${name.toLowerCase()}`;
    if (seen.has(key)) return fail(`${name} appears twice${category ? ` in ${category}` : ""}.`);
    seen.add(key);
    const nameNe = clean(col(r, "nameNe"));
    if (nameNe.length > 80) return fail(`${name}: the Nepali name is too long.`);
    const station = clean(col(r, "station"));
    rows.push({ line, category, name, nameNe: nameNe || null, price, station: station || null, prepMinutes: prep, available: avRaw ? YES.has(avRaw) : null });
  });
  return { rows, errors };
}

export interface ExistingDish {
  id: string;
  name: string;
  category: string;
  nameNe: string | null;
  price: number;
  station: string | null;
  prepMinutes: number;
  available: boolean;
}

export type Action = "ADD" | "UPDATE" | "SAME";

export interface PlanItem {
  row: ImportRow;
  action: Action;
  /** The dish it changes, for UPDATE and SAME. */
  existingId?: string;
  /** What would change, in words. */
  changes: string[];
}

/**
 * Matches each row to a dish already on the menu: by name in the same category; failing that, by name when only one dish has it (so a dish
 * moved to another category is updated, not doubled).
 */
export function planImport(rows: ImportRow[], existing: ExistingDish[]): PlanItem[] {
  const byNameCat = new Map(existing.map((d) => [`${d.category.toLowerCase()}|${d.name.toLowerCase()}`, d]));
  const byName = new Map<string, ExistingDish[]>();
  for (const d of existing) byName.set(d.name.toLowerCase(), [...(byName.get(d.name.toLowerCase()) ?? []), d]);
  const taken = new Set<string>();
  return rows.map((row) => {
    let hit = row.category ? byNameCat.get(`${row.category.toLowerCase()}|${row.name.toLowerCase()}`) : undefined;
    if (!hit) {
      const same = byName.get(row.name.toLowerCase()) ?? [];
      if (same.length === 1) hit = same[0];
    }
    if (!hit || taken.has(hit.id)) return { row, action: "ADD" as const, changes: ["new dish"] };
    taken.add(hit.id);
    const changes: string[] = [];
    const rs = (p: number) => `Rs ${p / 100}`;
    if (hit.price !== row.price) changes.push(`price ${rs(hit.price)} to ${rs(row.price)}`);
    if (row.category && hit.category.toLowerCase() !== row.category.toLowerCase()) changes.push(`category ${hit.category} to ${row.category}`);
    if (row.nameNe !== null && hit.nameNe !== row.nameNe) changes.push("Nepali name");
    if (row.station !== null && (hit.station ?? "").toLowerCase() !== row.station.toLowerCase()) changes.push(`station ${hit.station ?? "none"} to ${row.station}`);
    if (row.prepMinutes !== null && hit.prepMinutes !== row.prepMinutes) changes.push(`prep ${hit.prepMinutes} to ${row.prepMinutes} min`);
    if (row.available !== null && hit.available !== row.available) changes.push(row.available ? "switched on" : "switched off");
    return { row, action: changes.length ? ("UPDATE" as const) : ("SAME" as const), existingId: hit.id, changes };
  });
}

export function summarize(plan: PlanItem[]): { add: number; update: number; same: number } {
  return { add: plan.filter((p) => p.action === "ADD").length, update: plan.filter((p) => p.action === "UPDATE").length, same: plan.filter((p) => p.action === "SAME").length };
}

/** The menu as CSV text, in the same columns the import reads. */
export function menuToCsv(dishes: ExistingDish[]): string {
  return toCsv(
    ["Category", "Name", "Nepali name", "Price", "Station", "Prep minutes", "Available"],
    dishes.map((d) => [d.category, d.name, d.nameNe, rupees(d.price), d.station, d.prepMinutes, d.available ? "yes" : "no"]),
  );
}
