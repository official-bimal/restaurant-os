import { calculateBill, type BillTotals, type DiscountInput, type VatMode } from "@/features/billing/calc";

/**
 * Offline billing, the part that runs in BOTH places: on the phone while it has no connection, and on the server when the bill
 * arrives. It has no database and no network, so the phone and the server work a bill out with exactly the same code from
 * exactly the same inputs, and so get exactly the same total. The inputs are a "snapshot" the server signed while the phone
 * was online: the menu prices, the tax settings and the tables. The server trusts the snapshot only if its signature checks out.
 *
 * Scope: dine-in and takeaway bills of plain dishes (no add-on choices), paid by cash, QR or card, with an optional percent or
 * amount discount and an optional customer phone for loyalty points. Spending points, delivery and split bills need the server.
 */

export const SNAPSHOT_VERSION = 1;
/** A snapshot older than this is not accepted for billing: the prices on it are too old to trust. */
export const SNAPSHOT_MAX_AGE_DAYS = 30;
export const MAX_LINES = 60;
export const MAX_QTY = 99;

export interface OfflineSnapshot {
  v: number;
  /** ISO time the server made it. */
  issuedAt: string;
  businessId: string;
  branchId: string;
  userId: string;
  business: {
    name: string;
    pan: string | null;
    timezone: string;
    serviceChargeBps: number;
    vatMode: VatMode;
    vatBps: number;
    vatAppliesToServiceCharge: boolean;
    roundToRupee: boolean;
  };
  branch: { name: string; address: string | null };
  /** Plain dishes this branch can sell right now, at this branch's prices. */
  items: { id: string; name: string; price: number; category: string }[];
  tables: { id: string; label: string }[];
}

export type PayMethod = "CASH" | "QR" | "CARD";
export const PAY_METHODS: readonly PayMethod[] = ["CASH", "QR", "CARD"];

export interface OfflineBillInput {
  /** Made on the phone for this bill: a repeat send with the same key never makes a second bill. */
  key: string;
  deviceId: string;
  type: "DINE_IN" | "TAKEAWAY";
  tableId: string | null;
  /** ISO time of the sale on the phone's clock. */
  billedAt: string;
  /** The invoice number taken from the phone's reserved block. */
  invoiceNumber: number;
  items: { menuItemId: string; quantity: number; note?: string }[];
  discount: DiscountInput;
  payments: { method: PayMethod; amount: number }[];
  /** The total the phone worked out and printed. The server checks it against its own. */
  expectedTotal: number;
  customerPhone?: string;
}

export class OfflineBillError extends Error {}

export interface PricedLine {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  note: string | null;
}

/** Price a cart from the snapshot and work out the bill. Throws OfflineBillError for anything that cannot be billed. */
export function priceOfflineBill(snap: OfflineSnapshot, items: OfflineBillInput["items"], discount: DiscountInput): { lines: PricedLine[]; totals: BillTotals } {
  if (items.length === 0) throw new OfflineBillError("There is nothing to bill.");
  if (items.length > MAX_LINES) throw new OfflineBillError(`A bill can have at most ${MAX_LINES} lines.`);
  const byId = new Map(snap.items.map((i) => [i.id, i]));
  const lines: PricedLine[] = items.map((i) => {
    const dish = byId.get(i.menuItemId);
    if (!dish) throw new OfflineBillError("A dish on this bill is not on the menu this phone was given.");
    if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > MAX_QTY) throw new OfflineBillError(`Quantity must be 1 to ${MAX_QTY}.`);
    const note = (i.note ?? "").trim().slice(0, 200);
    return { menuItemId: dish.id, name: dish.name, quantity: i.quantity, unitPrice: dish.price, note: note || null };
  });
  const b = snap.business;
  try {
    const totals = calculateBill(
      lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
      { discount, serviceChargeBps: b.serviceChargeBps, vatMode: b.vatMode, vatBps: b.vatBps, vatAppliesToServiceCharge: b.vatAppliesToServiceCharge, roundToRupee: b.roundToRupee },
    );
    return { lines, totals };
  } catch (e) {
    if (e instanceof RangeError) throw new OfflineBillError(e.message);
    throw e;
  }
}

/** Payments must be positive whole paisa and add up to the total exactly (the same rule as paying online). */
export function checkPayments(total: number, payments: OfflineBillInput["payments"]): void {
  if (payments.length === 0) throw new OfflineBillError("Enter how the bill was paid.");
  for (const p of payments) {
    if (!PAY_METHODS.includes(p.method)) throw new OfflineBillError("Choose cash, QR or card.");
    if (!Number.isInteger(p.amount) || p.amount <= 0) throw new OfflineBillError("Payment amounts must be positive.");
  }
  if (payments.reduce((n, p) => n + p.amount, 0) !== total) throw new OfflineBillError("Payments must add up exactly to the bill total.");
}

/** Is a discount sane? (The totals function rejects the rest.) */
export function checkDiscount(d: DiscountInput): void {
  if (d.kind === "percent" && (!Number.isInteger(d.bps) || d.bps < 0 || d.bps > 10_000)) throw new OfflineBillError("A discount must be 0 to 100 percent.");
  if (d.kind === "amount" && (!Number.isInteger(d.amount) || d.amount < 0)) throw new OfflineBillError("A discount amount cannot be negative.");
}

// --- invoice numbers on the phone ---------------------------------------------------------

export interface NumberBlock {
  from: number;
  to: number;
}

/** The lowest reserved number not yet used, or null when the phone has run out. */
export function nextInvoiceNumber(blocks: NumberBlock[], used: ReadonlySet<number>): number | null {
  let best: number | null = null;
  for (const b of blocks) {
    for (let n = b.from; n <= b.to; n++) {
      if (!used.has(n)) {
        if (best === null || n < best) best = n;
        break;
      }
    }
  }
  return best;
}

export function numbersLeft(blocks: NumberBlock[], used: ReadonlySet<number>): number {
  let left = 0;
  for (const b of blocks) for (let n = b.from; n <= b.to; n++) if (!used.has(n)) left++;
  return left;
}

/** Time checks shared by the phone and the server. Returns a reason the bill cannot be accepted, or null. */
export function billTimeProblem(snap: Pick<OfflineSnapshot, "issuedAt">, billedAt: string, now: Date): string | null {
  const t = Date.parse(billedAt);
  const issued = Date.parse(snap.issuedAt);
  if (!Number.isFinite(t) || !Number.isFinite(issued)) return "The bill has no valid time.";
  if (t > now.getTime() + 5 * 60_000) return "The bill is dated in the future. Check the phone's clock.";
  if (t < issued - 60 * 60_000) return "The bill is dated before the menu it used was loaded. Check the phone's clock.";
  if (t - issued > SNAPSHOT_MAX_AGE_DAYS * 86_400_000) return `The menu on this phone is more than ${SNAPSHOT_MAX_AGE_DAYS} days old. Connect to the internet to refresh it.`;
  return null;
}
