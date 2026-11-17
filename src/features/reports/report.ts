/**
 * Daily report maths. Pure functions, no I/O. All money is integer paisa.
 *
 * Sales are counted on the day the invoice was issued. A refund is counted on the day the
 * credit note was issued, never by editing the original day: yesterday's report stays as it was.
 */

export type Method = "CASH" | "CARD" | "QR" | "CREDIT";
export const METHODS: readonly Method[] = ["CASH", "QR", "CARD", "CREDIT"];

export interface InvoiceInput {
  number: number;
  subtotal: number;
  discount: number;
  loyaltyDiscount: number;
  serviceCharge: number;
  vat: number;
  roundOff: number;
  deliveryFee?: number;
  grandTotal: number;
  orderType: "DINE_IN" | "TAKEAWAY" | "QUICK_BILL" | "DELIVERY";
  payments: { method: Method; amount: number }[];
}

export interface CreditNoteInput {
  number: number;
  invoiceNumber: number;
  grandTotal: number;
  vat: number;
  reason: string;
  refunds: { method: Method; amount: number }[];
}

export interface ReportInput {
  invoices: InvoiceInput[];
  creditNotes: CreditNoteInput[];
  /** Items on the orders that were invoiced in the period (cancelled items excluded). */
  items: { name: string; quantity: number; unitPrice: number; complimentary: boolean }[];
  cancelled: { number: number; reason: string | null; itemCount: number }[];
  /** Cost of the ingredients used by the day's sales, in paisa (from recipes). */
  foodCost?: number;
  /** List-price sales of the dishes that have a recipe, so the cost share is like for like. */
  recipeSales?: number;
}

export interface DayReport {
  sales: {
    count: number;
    subtotal: number;
    discount: number;
    loyaltyDiscount: number;
    serviceCharge: number;
    vat: number;
    roundOff: number;
    deliveryFee: number;
    gross: number;
    average: number;
  };
  refunds: { count: number; total: number; vat: number };
  /** Gross sales minus refunds. */
  net: number;
  netVat: number;
  byMethod: Record<Method, { sales: number; refunds: number; net: number }>;
  /** Cash that should be in the drawer: cash taken minus cash handed back. */
  expectedCash: number;
  byType: { type: string; count: number; total: number }[];
  topItems: { name: string; quantity: number; revenue: number }[];
  cancelled: { count: number; orders: { number: number; reason: string | null; itemCount: number }[] };
  refundList: { number: number; invoiceNumber: number; total: number; reason: string }[];
  /** Ingredient cost of what was sold, and as a share of the sales price of the dishes that have a recipe (null if none). */
  foodCost: number;
  foodCostPercent: number | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function buildReport(input: ReportInput): DayReport {
  const { invoices, creditNotes } = input;
  const gross = sum(invoices.map((i) => i.grandTotal));
  const refundsTotal = sum(creditNotes.map((c) => c.grandTotal));

  const byMethod = Object.fromEntries(METHODS.map((m) => [m, { sales: 0, refunds: 0, net: 0 }])) as DayReport["byMethod"];
  for (const inv of invoices) for (const p of inv.payments) byMethod[p.method].sales += p.amount;
  for (const c of creditNotes) for (const r of c.refunds) byMethod[r.method].refunds += r.amount;
  for (const m of METHODS) byMethod[m].net = byMethod[m].sales - byMethod[m].refunds;

  const types = new Map<string, { count: number; total: number }>();
  for (const inv of invoices) {
    const t = types.get(inv.orderType) ?? { count: 0, total: 0 };
    t.count += 1;
    t.total += inv.grandTotal;
    types.set(inv.orderType, t);
  }

  // Item revenue is the list price of what was ordered, before bill-level discounts and charges.
  const items = new Map<string, { quantity: number; revenue: number }>();
  for (const i of input.items) {
    const t = items.get(i.name) ?? { quantity: 0, revenue: 0 };
    t.quantity += i.quantity;
    t.revenue += i.complimentary ? 0 : i.quantity * i.unitPrice;
    items.set(i.name, t);
  }

  const foodCost = input.foodCost ?? 0;
  const recipeSales = input.recipeSales ?? 0;

  return {
    sales: {
      count: invoices.length,
      subtotal: sum(invoices.map((i) => i.subtotal)),
      discount: sum(invoices.map((i) => i.discount)),
      loyaltyDiscount: sum(invoices.map((i) => i.loyaltyDiscount)),
      serviceCharge: sum(invoices.map((i) => i.serviceCharge)),
      vat: sum(invoices.map((i) => i.vat)),
      roundOff: sum(invoices.map((i) => i.roundOff)),
      deliveryFee: sum(invoices.map((i) => i.deliveryFee ?? 0)),
      gross,
      average: invoices.length ? Math.round(gross / invoices.length) : 0,
    },
    refunds: { count: creditNotes.length, total: refundsTotal, vat: sum(creditNotes.map((c) => c.vat)) },
    net: gross - refundsTotal,
    netVat: sum(invoices.map((i) => i.vat)) - sum(creditNotes.map((c) => c.vat)),
    byMethod,
    expectedCash: byMethod.CASH.net,
    byType: [...types.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.total - a.total),
    topItems: [...items.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || a.name.localeCompare(b.name))
      .slice(0, 10),
    cancelled: { count: input.cancelled.length, orders: input.cancelled },
    refundList: creditNotes.map((c) => ({ number: c.number, invoiceNumber: c.invoiceNumber, total: c.grandTotal, reason: c.reason })),
    foodCost,
    foodCostPercent: recipeSales > 0 && foodCost > 0 ? Math.round((foodCost / recipeSales) * 1000) / 10 : null,
  };
}

/** All branches' reports for one period added together, plus what each branch did, for the combined report. */
export interface CombinedReport {
  sales: { count: number; gross: number; discount: number; serviceCharge: number; vat: number; deliveryFee: number; average: number };
  refunds: { count: number; total: number };
  net: number;
  netVat: number;
  byMethod: Record<Method, { sales: number; refunds: number; net: number }>;
  byType: { type: string; count: number; total: number }[];
  topItems: { name: string; quantity: number; revenue: number }[];
  cancelledCount: number;
  foodCost: number;
}

/** Add several reports (one per branch) into one. Pure; nothing is lost: every total is the sum of the branches' totals. */
export function combineReports(reports: DayReport[]): CombinedReport {
  const byMethod = Object.fromEntries(METHODS.map((m) => [m, { sales: 0, refunds: 0, net: 0 }])) as CombinedReport["byMethod"];
  const types = new Map<string, { count: number; total: number }>();
  const items = new Map<string, { quantity: number; revenue: number }>();
  for (const r of reports) {
    for (const m of METHODS) {
      byMethod[m].sales += r.byMethod[m].sales;
      byMethod[m].refunds += r.byMethod[m].refunds;
      byMethod[m].net += r.byMethod[m].net;
    }
    for (const t of r.byType) {
      const cur = types.get(t.type) ?? { count: 0, total: 0 };
      types.set(t.type, { count: cur.count + t.count, total: cur.total + t.total });
    }
    for (const i of r.topItems) {
      const cur = items.get(i.name) ?? { quantity: 0, revenue: 0 };
      items.set(i.name, { quantity: cur.quantity + i.quantity, revenue: cur.revenue + i.revenue });
    }
  }
  const count = sum(reports.map((r) => r.sales.count));
  const gross = sum(reports.map((r) => r.sales.gross));
  return {
    sales: {
      count,
      gross,
      discount: sum(reports.map((r) => r.sales.discount)),
      serviceCharge: sum(reports.map((r) => r.sales.serviceCharge)),
      vat: sum(reports.map((r) => r.sales.vat)),
      deliveryFee: sum(reports.map((r) => r.sales.deliveryFee)),
      average: count ? Math.round(gross / count) : 0,
    },
    refunds: { count: sum(reports.map((r) => r.refunds.count)), total: sum(reports.map((r) => r.refunds.total)) },
    net: sum(reports.map((r) => r.net)),
    netVat: sum(reports.map((r) => r.netVat)),
    byMethod,
    byType: [...types.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.total - a.total),
    topItems: [...items.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || a.name.localeCompare(b.name))
      .slice(0, 10),
    cancelledCount: sum(reports.map((r) => r.cancelled.count)),
    foodCost: sum(reports.map((r) => r.foodCost)),
  };
}
