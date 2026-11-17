/** Pure helpers for printed documents (receipts, credit notes, kitchen tickets). No database, no formatting of paper. */

export interface PrintItem {
  name: string;
  quantity: number;
  unitPrice: number;
  complimentary: boolean;
  note: string | null;
  status: string;
  addOns: { name: string; price: number }[];
}

export interface ReceiptLine {
  name: string;
  quantity: number;
  unitPrice: number;
  /// What the guest pays for the line (0 when complimentary).
  total: number;
  complimentary: boolean;
  note: string | null;
  addOns: string[];
}

/** The lines of a bill: cancelled items are left out, complimentary ones are shown at no charge. */
export function receiptLines(items: PrintItem[]): ReceiptLine[] {
  return items
    .filter((i) => i.status !== "CANCELLED")
    .map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: i.complimentary ? 0 : i.unitPrice * i.quantity,
      complimentary: i.complimentary,
      note: i.note,
      addOns: i.addOns.map((a) => a.name),
    }));
}

/** Paper widths the print pages support, in millimetres. */
export const PAPER_WIDTHS = [58, 80] as const;
export type PaperWidth = (typeof PAPER_WIDTHS)[number];

export function paperWidth(value: string | string[] | undefined): PaperWidth {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (PAPER_WIDTHS as readonly number[]).includes(n) ? (n as PaperWidth) : 80;
}

/** Kitchen ticket items grouped by station, in the order the stations first appear. Cancelled items are left out. */
export function groupByStation<T extends { status: string; station: string | null }>(items: T[]): { station: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const i of items) {
    if (i.status === "CANCELLED") continue;
    const key = i.station ?? "Other";
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return [...groups].map(([station, list]) => ({ station, items: list }));
}
