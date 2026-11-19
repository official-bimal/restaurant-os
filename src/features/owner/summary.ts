import { formatNpr } from "@/features/billing/calc";

/**
 * The owner's daily summary as text. Pure: the numbers come in, a short version (for a text message or a push) and a full
 * version (for email or the page) come out.
 */

export interface SummaryData {
  business: string;
  /** "Tuesday 24 November 2026". */
  dateLabel: string;
  branches: string[];
  sales: { count: number; gross: number; average: number; discount: number; vat: number };
  refunds: { count: number; total: number };
  net: number;
  byMethod: { cash: number; qr: number; card: number; credit: number };
  cancelled: { count: number; amount: number };
  cash: { branch: string; difference: number }[];
  foodCost: number;
  topItems: { name: string; quantity: number }[];
  staff: { name: string; minutes: number; stillIn: boolean }[];
  staffOff: string[];
  alerts: { title: string }[];
  /** Ingredient cost as a share of food sales, when it can be worked out. */
  foodCostPercent?: number | null;
  /** Stock at or below its reorder level (or out), most urgent first. */
  lowStock?: { name: string; unit: string; left: number }[];
  /** Bookings for the next day that are waiting or confirmed. */
  tomorrowBookings?: number;
  /** Automatic deals that took something off a bill today. */
  deals?: { bills: number; saved: number };
  /** Hukkas started today and how long the finished ones ran on average. */
  hukka?: { started: number; averageMinutes: number | null; coils: number };
}

const qty = (n: number, unit: string) => {
  const v = Math.max(0, n);
  if (unit === "g") return v >= 1000 ? `${Math.round(v / 100) / 10} kg` : `${v} g`;
  if (unit === "ml") return v >= 1000 ? `${Math.round(v / 100) / 10} L` : `${v} ml`;
  return `${v} pc`;
};

const hours = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

export function shortSummary(d: SummaryData): string {
  const parts = [
    `${d.business} ${d.dateLabel}`,
    `Sales ${formatNpr(d.net)} (${d.sales.count} bill${d.sales.count === 1 ? "" : "s"})`,
    `Cash ${formatNpr(d.byMethod.cash)}, QR ${formatNpr(d.byMethod.qr)}, card ${formatNpr(d.byMethod.card)}`,
  ];
  if (d.refunds.count) parts.push(`Refunds ${formatNpr(d.refunds.total)}`);
  if (d.cancelled.count) parts.push(`Cancelled ${d.cancelled.count}`);
  const short = d.cash.filter((c) => c.difference !== 0);
  if (short.length) parts.push(`Cash ${short.map((c) => `${c.difference < 0 ? "short" : "over"} ${formatNpr(Math.abs(c.difference))}`).join(", ")}`);
  if (d.foodCostPercent != null) parts.push(`Food cost ${d.foodCostPercent}%`);
  if (d.lowStock?.length) parts.push(`Low stock: ${d.lowStock.slice(0, 3).map((s) => s.name).join(", ")}${d.lowStock.length > 3 ? ` +${d.lowStock.length - 3}` : ""}`);
  if (d.tomorrowBookings) parts.push(`${d.tomorrowBookings} booking${d.tomorrowBookings === 1 ? "" : "s"} tomorrow`);
  parts.push(`Staff ${d.staff.length} in, ${d.staffOff.length} off`);
  if (d.alerts.length) parts.push(`${d.alerts.length} alert${d.alerts.length === 1 ? "" : "s"} to check`);
  return parts.join(" · ");
}

export function fullSummary(d: SummaryData): string[] {
  const L: string[] = [];
  L.push(`${d.business}: daily summary`, d.dateLabel + (d.branches.length > 1 ? ` · ${d.branches.join(", ")}` : ""), "");
  L.push("SALES");
  L.push(`  After refunds: ${formatNpr(d.net)}`);
  L.push(`  Bills paid: ${d.sales.count}${d.sales.count ? ` · average ${formatNpr(d.sales.average)}` : ""}`);
  L.push(`  Before refunds: ${formatNpr(d.sales.gross)} · discounts ${formatNpr(d.sales.discount)} · VAT ${formatNpr(d.sales.vat)}`);
  L.push(`  Taken as: cash ${formatNpr(d.byMethod.cash)} · QR ${formatNpr(d.byMethod.qr)} · card ${formatNpr(d.byMethod.card)}${d.byMethod.credit ? ` · credit ${formatNpr(d.byMethod.credit)}` : ""}`);
  L.push("", "MONEY OUT");
  L.push(`  Refunds: ${d.refunds.count ? `${d.refunds.count} for ${formatNpr(d.refunds.total)}` : "none"}`);
  L.push(`  Cancelled bills: ${d.cancelled.count ? `${d.cancelled.count} worth ${formatNpr(d.cancelled.amount)}` : "none"}`);
  L.push("", "CASH COUNT");
  if (d.cash.length === 0) L.push("  The day has not been closed yet.");
  for (const c of d.cash) L.push(`  ${c.branch}: ${c.difference === 0 ? "matches" : `${c.difference < 0 ? "short" : "over"} by ${formatNpr(Math.abs(c.difference))}`}`);
  if (d.foodCost > 0) L.push("", `FOOD COST  ${formatNpr(d.foodCost)}${d.foodCostPercent != null ? ` (${d.foodCostPercent}% of food sales)` : ""}`);
  if (d.topItems.length) {
    L.push("", "BEST SELLERS");
    for (const t of d.topItems) L.push(`  ${t.quantity} × ${t.name}`);
  }
  if (d.deals && d.deals.bills > 0) L.push("", "DEALS", `  ${d.deals.bills} bill${d.deals.bills === 1 ? "" : "s"} used a deal, ${formatNpr(d.deals.saved)} off`);
  if (d.hukka && d.hukka.started > 0) L.push("", "HUKKA", `  ${d.hukka.started} started${d.hukka.averageMinutes != null ? `, about ${d.hukka.averageMinutes} min each` : ""}, ${d.hukka.coils} extra coil${d.hukka.coils === 1 ? "" : "s"}`);
  if (d.lowStock?.length) {
    L.push("", "RUNNING LOW");
    for (const s of d.lowStock.slice(0, 8)) L.push(`  ${s.name}: ${s.left <= 0 ? "out" : qty(s.left, s.unit) + " left"}`);
    if (d.lowStock.length > 8) L.push(`  and ${d.lowStock.length - 8} more (see What to order)`);
  }
  if (d.tomorrowBookings) L.push("", "TOMORROW", `  ${d.tomorrowBookings} table booking${d.tomorrowBookings === 1 ? "" : "s"}`);
  L.push("", "STAFF");
  if (d.staff.length === 0) L.push("  Nobody clocked in.");
  for (const s of d.staff) L.push(`  ${s.name}: ${hours(s.minutes)}${s.stillIn ? " (still clocked in)" : ""}`);
  if (d.staffOff.length) L.push(`  Off / not in: ${d.staffOff.join(", ")}`);
  L.push("", "THINGS TO CHECK");
  if (d.alerts.length === 0) L.push("  Nothing unusual.");
  for (const a of d.alerts) L.push(`  • ${a.title}`);
  return L;
}
