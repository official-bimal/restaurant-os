/**
 * Which fields print on a kitchen slip (KOT) and on a bill. Pure: the list of choices, their usual setting, and reading a saved or posted
 * value safely. What the law needs on a tax invoice (invoice number, date, VAT and totals) is not in the list, so it cannot be switched off.
 */

export interface FieldDef {
  key: string;
  label: string;
  hint: string;
  /** The setting when nobody has chosen. */
  on: boolean;
}

export const KOT_FIELDS = [
  { key: "orderNumber", label: "Order number", hint: "The order's number, next to the table", on: true },
  { key: "table", label: "Table or order type", hint: "Table 4, Takeaway or Delivery", on: true },
  { key: "time", label: "Time", hint: "When the order was taken", on: true },
  { key: "branch", label: "Branch name", hint: "Useful when slips from several branches mix", on: true },
  { key: "waiter", label: "Who took the order", hint: "The waiter's name", on: false },
  { key: "orderNote", label: "Order note", hint: "Allergy or a request for the whole order", on: true },
  { key: "station", label: "Station heading", hint: "BAR, GRILL... above each group of dishes", on: true },
  { key: "itemNote", label: "Item notes", hint: "No sugar, extra spicy", on: true },
  { key: "addOns", label: "Add-ons", hint: "Extra cheese, large size", on: true },
  { key: "itemCount", label: "Total items at the bottom", hint: "How many dishes are on the slip", on: false },
] as const satisfies readonly FieldDef[];

export const BILL_FIELDS = [
  { key: "orderNumber", label: "Order number", hint: "Printed beside the invoice number", on: true },
  { key: "table", label: "Table or order type", hint: "Table 4, Takeaway or Delivery", on: true },
  { key: "bsDate", label: "Nepali date (BS)", hint: "The Miti line under the date", on: true },
  { key: "itemDetails", label: "Item notes and add-ons", hint: "The extras printed under a dish", on: true },
  { key: "payments", label: "How it was paid", hint: "Paid by cash, card or QR lines", on: true },
] as const satisfies readonly FieldDef[];

export type KotKey = (typeof KOT_FIELDS)[number]["key"];
export type BillKey = (typeof BILL_FIELDS)[number]["key"];

export interface SlipFields {
  kot: Record<KotKey, boolean>;
  bill: Record<BillKey, boolean>;
}

const defaults = <K extends string>(defs: readonly { key: K; on: boolean }[]) => Object.fromEntries(defs.map((d) => [d.key, d.on])) as Record<K, boolean>;

export const DEFAULT_FIELDS: SlipFields = { kot: defaults(KOT_FIELDS), bill: defaults(BILL_FIELDS) };

function readGroup<K extends string>(defs: readonly { key: K; on: boolean }[], raw: unknown): Record<K, boolean> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(defs.map((d) => [d.key, typeof src[d.key] === "boolean" ? src[d.key] : d.on])) as Record<K, boolean>;
}

/** A saved value (or nothing, or rubbish) turned into a complete set: anything missing or not true/false takes its usual setting. */
export function cleanFields(raw: unknown): SlipFields {
  const r = raw && typeof raw === "object" ? (raw as { kot?: unknown; bill?: unknown }) : {};
  return { kot: readGroup(KOT_FIELDS, r.kot), bill: readGroup(BILL_FIELDS, r.bill) };
}

/** From the posted form: a ticked box is on, an unticked one is off. */
export function fieldsFromForm(has: (name: string) => boolean): SlipFields {
  return {
    kot: Object.fromEntries(KOT_FIELDS.map((f) => [f.key, has(`kot.${f.key}`)])) as SlipFields["kot"],
    bill: Object.fromEntries(BILL_FIELDS.map((f) => [f.key, has(`bill.${f.key}`)])) as SlipFields["bill"],
  };
}
