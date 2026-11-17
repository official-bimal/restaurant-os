/**
 * The phone's side of offline billing: what it keeps in the browser's storage, taking invoice numbers from its reserved block,
 * making a bill, and sending saved bills. Everything that decides money (prices, tax, totals) is in billing.ts and runs the same
 * here and on the server. This file never uses React so it can be tested and reasoned about on its own.
 *
 * Storage keys (all in the browser, per device):
 *   ros-pos-device    the phone's random id
 *   ros-pos-snapshot  { snapshot (JSON text, exactly as signed), sig, fetchedAt, canBill, print }
 *   ros-pos-blocks    [{ id, from, to }]  invoice numbers set aside for this phone
 *   ros-pos-used      [number]            numbers already taken here (kept even if the bill is dismissed, so one is never used twice)
 *   ros-pos-bills     saved bills and what happened to them
 */

import type { DiscountInput } from "@/features/billing/calc";
import { layoutReceipt, DEFAULT_LAYOUT, type LayoutSettings, type ReceiptData } from "@/features/printing/layout";
import { buildPdf, charsPerLine } from "@/lib/pdf";
import {
  billTimeProblem,
  checkDiscount,
  checkPayments,
  nextInvoiceNumber,
  numbersLeft,
  OfflineBillError,
  priceOfflineBill,
  type NumberBlock,
  type OfflineBillInput,
  type OfflineSnapshot,
  type PayMethod,
} from "./billing";

export interface PrintInfo extends LayoutSettings {
  paperWidthMm: number;
  paperHeightMm: number | null;
  marginMm: number;
  fontSizeTenthPt: number;
}

export const DEFAULT_PRINT: PrintInfo = { ...DEFAULT_LAYOUT, paperWidthMm: 80, paperHeightMm: null, marginMm: 4, fontSizeTenthPt: 90 };

export interface StoredSnapshot {
  snapshot: string;
  sig: string;
  fetchedAt: string;
  canBill: boolean;
  print: PrintInfo;
}

export type BillState = "queued" | "synced" | "problem";

export interface SavedBill {
  bill: OfflineBillInput;
  /** What was shown on the receipt: kept so it can be printed again. */
  receipt: ReceiptData;
  tableLabel: string;
  state: BillState;
  code?: string;
  message?: string;
  invoiceNumber: number;
  orderNumber?: number;
  createdAt: string;
}

const K = { device: "ros-pos-device", snap: "ros-pos-snapshot", blocks: "ros-pos-blocks", used: "ros-pos-used", bills: "ros-pos-bills" } as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function randomId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function getDeviceId(): string {
  let id = "";
  try {
    id = localStorage.getItem(K.device) ?? "";
  } catch {
    /* ignore */
  }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    id = randomId();
    try {
      localStorage.setItem(K.device, id);
    } catch {
      /* ignore */
    }
  }
  return id;
}

export const loadSnapshot = () => read<StoredSnapshot | null>(K.snap, null);
export const parseSnapshot = (s: StoredSnapshot): OfflineSnapshot => JSON.parse(s.snapshot) as OfflineSnapshot;
export const loadBlocks = () => read<(NumberBlock & { id: string })[]>(K.blocks, []);
export const loadUsed = () => new Set(read<number[]>(K.used, []));
export const loadBills = () => read<SavedBill[]>(K.bills, []);
export const saveBills = (bills: SavedBill[]) => write(K.bills, bills);

export function numbersAvailable(): number {
  return numbersLeft(loadBlocks(), loadUsed());
}

/** While online: get a fresh signed menu and top up invoice numbers. Returns an error in plain words, or null when fine. */
export async function prepareOffline(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl("/api/offline/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: getDeviceId() }) });
    if (res.status === 401) return "Please sign in again to get this phone ready for working offline.";
    const data = (await res.json().catch(() => null)) as { error?: string; snapshot?: string; sig?: string; canBill?: boolean; print?: PrintInfo; blocks?: (NumberBlock & { id: string })[]; used?: number[] } | null;
    if (!res.ok || !data || !data.snapshot || !data.sig) return data?.error ?? "Could not get this phone ready for working offline.";
    write(K.snap, { snapshot: data.snapshot, sig: data.sig, fetchedAt: new Date().toISOString(), canBill: !!data.canBill, print: data.print ?? DEFAULT_PRINT } satisfies StoredSnapshot);
    write(K.blocks, data.blocks ?? []);
    // Numbers the server already has bills for are used; keep every number this phone has used itself too.
    const used = loadUsed();
    for (const n of data.used ?? []) used.add(n);
    write(K.used, [...used]);
    return null;
  } catch {
    return null; // no connection: keep working from what is stored
  }
}

// --- making a bill ---------------------------------------------------------------------------

export interface MakeBillInput {
  type: "DINE_IN" | "TAKEAWAY";
  tableId: string | null;
  items: { menuItemId: string; quantity: number; note?: string }[];
  discount: DiscountInput;
  payments: { method: PayMethod; amount: number }[];
  customerPhone?: string;
}

export function previewTotals(snap: OfflineSnapshot, items: MakeBillInput["items"], discount: DiscountInput) {
  checkDiscount(discount);
  return priceOfflineBill(snap, items, discount);
}

/**
 * Make a bill: check it, price it from the signed snapshot, take the next invoice number, and save it BEFORE anything else so a
 * crash or a lost connection cannot lose it. Throws OfflineBillError with a plain reason when it cannot be billed.
 */
export function makeBill(stored: StoredSnapshot, input: MakeBillInput, now: Date = new Date()): SavedBill {
  if (!stored.canBill) throw new OfflineBillError("You are not allowed to take payments.");
  const snap = parseSnapshot(stored);
  const timeProblem = billTimeProblem(snap, now.toISOString(), now);
  if (timeProblem) throw new OfflineBillError(timeProblem);
  const priced = previewTotals(snap, input.items, input.discount);
  checkPayments(priced.totals.grandTotal, input.payments);
  if (input.type === "DINE_IN" && (!input.tableId || !snap.tables.some((t) => t.id === input.tableId))) throw new OfflineBillError("Choose a table.");

  const blocks = loadBlocks();
  const used = loadUsed();
  const number = nextInvoiceNumber(blocks, used);
  if (number === null) throw new OfflineBillError("This phone has no invoice numbers left. Connect to the internet once to get more.");

  const bill: OfflineBillInput = {
    key: `bill-${randomId()}`,
    deviceId: getDeviceId(),
    type: input.type,
    tableId: input.type === "DINE_IN" ? input.tableId : null,
    billedAt: now.toISOString(),
    invoiceNumber: number,
    items: input.items,
    discount: input.discount,
    payments: input.payments,
    expectedTotal: priced.totals.grandTotal,
    customerPhone: input.customerPhone?.trim() || undefined,
  };
  const tableLabel = input.type === "DINE_IN" ? (snap.tables.find((t) => t.id === input.tableId)?.label ?? "") : "Takeaway";
  const t = priced.totals;
  const receipt: ReceiptData = {
    business: snap.business.name,
    pan: snap.business.pan,
    branch: snap.branch.name,
    address: snap.branch.address,
    invoiceNumber: number,
    orderNumber: null,
    when: now.toLocaleString("en-GB", { timeZone: snap.business.timezone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    where: tableLabel,
    customer: null,
    lines: priced.lines.map((l) => ({ name: l.name, quantity: l.quantity, total: l.unitPrice * l.quantity, complimentary: false, note: l.note, addOns: [] })),
    subtotal: t.subtotal,
    discount: t.discount,
    loyaltyDiscount: 0,
    serviceCharge: t.serviceCharge,
    vat: t.vat,
    deliveryFee: 0,
    roundOff: t.roundOff,
    grandTotal: t.grandTotal,
    payments: input.payments.map((p) => ({ method: p.method, amount: p.amount })),
    creditNotes: [],
  };
  const saved: SavedBill = { bill, receipt, tableLabel, state: "queued", invoiceNumber: number, createdAt: now.toISOString() };
  // Mark the number used and keep the bill in one step; refuse if the browser cannot store it, rather than print a bill that could be lost.
  used.add(number);
  const okUsed = write(K.used, [...used]);
  const okBills = saveBills([...loadBills(), saved]);
  if (!okUsed || !okBills) throw new OfflineBillError("This phone's storage is full or blocked, so the bill could not be saved safely. Nothing was billed.");
  return saved;
}

// --- sending ---------------------------------------------------------------------------------

export interface SyncOutcome {
  sent: number;
  problems: number;
  /** True when it stopped because there was no connection or the server had a problem (try again later). */
  waiting: boolean;
}

let syncing = false;

/** Send every saved bill that has not been recorded yet, one at a time. Safe to call as often as you like. */
export async function syncBills(fetchImpl: typeof fetch = fetch): Promise<SyncOutcome> {
  const out: SyncOutcome = { sent: 0, problems: 0, waiting: false };
  const stored = loadSnapshot();
  if (syncing || !stored) return out;
  syncing = true;
  try {
    for (const entry of loadBills().filter((b) => b.state === "queued")) {
      let res: Response;
      try {
        res = await fetchImpl("/api/offline/bill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshot: stored.snapshot, sig: stored.sig, bill: entry.bill }) });
      } catch {
        out.waiting = true;
        break;
      }
      const data = (await res.json().catch(() => null)) as { ok?: boolean; invoiceNumber?: number; orderNumber?: number; code?: string; error?: string; retry?: boolean } | null;
      const update = (patch: Partial<SavedBill>) => saveBills(loadBills().map((b) => (b.bill.key === entry.bill.key ? { ...b, ...patch } : b)));
      if (data?.ok) {
        update({ state: "synced", orderNumber: data.orderNumber, message: undefined, code: undefined });
        out.sent++;
      } else if (data && data.retry === false) {
        update({ state: "problem", code: data.code, message: data.error });
        out.problems++;
      } else {
        out.waiting = true; // 401, 5xx or an unreadable answer: leave it and try again later
        break;
      }
    }
  } finally {
    syncing = false;
  }
  return out;
}

export function retryBill(key: string) {
  saveBills(loadBills().map((b) => (b.bill.key === key && b.state === "problem" ? { ...b, state: "queued" as const, message: undefined, code: undefined } : b)));
}

/** Remove a synced bill from the list, or a problem bill the owner has dealt with. A bill still waiting to be sent cannot be removed. */
export function dismissBill(key: string) {
  saveBills(loadBills().filter((b) => !(b.bill.key === key && b.state !== "queued")));
}

// --- the receipt, with no connection needed ------------------------------------------------------

/** A PDF of the receipt, built right here on the phone. `paper` can override the saved size for one print. */
export function receiptPdf(saved: SavedBill, print: PrintInfo | undefined, paper: { widthMm?: number; heightMm?: number | null } = {}): Uint8Array {
  const p = print ?? DEFAULT_PRINT;
  const page = { widthMm: paper.widthMm ?? p.paperWidthMm, heightMm: paper.heightMm === undefined ? p.paperHeightMm : paper.heightMm, marginMm: p.marginMm, fontPt: p.fontSizeTenthPt / 10 };
  return buildPdf(layoutReceipt(saved.receipt, p, charsPerLine(page)), page);
}
