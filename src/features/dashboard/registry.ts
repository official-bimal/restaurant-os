import { can, type Permission, type PermissionSubject } from "@/server/permissions";
import type { Size, Template, WidgetInfo } from "./layout";

/**
 * The widget library. Each entry says what a widget is, who may see it and which sizes it offers; what it draws lives in widgets.tsx and
 * the data it needs in server/data.ts. To add a widget later: add an entry here, a data field if it needs one, and a renderer. The layout
 * engine, the editor and the saved layouts need no changes: a widget a person has never seen simply appears after the ones they arranged.
 */

export type WidgetGroup = "Numbers" | "Charts" | "Lists" | "Shortcuts";

export interface WidgetDef extends WidgetInfo {
  title: string;
  description: string;
  group: WidgetGroup;
  /** Shown only to people who hold at least one of these permissions. Empty: everyone who can open the dashboard. */
  needs: readonly Permission[];
}

const def = (id: string, title: string, group: WidgetGroup, defaultSize: Size, sizes: readonly Size[], needs: readonly Permission[], description: string): WidgetDef => ({
  id,
  title,
  group,
  defaultSize,
  sizes,
  needs,
  description,
});

export const WIDGETS: readonly WidgetDef[] = [
  def("salesToday", "Sales today", "Numbers", "S", ["S", "M"], ["report.view"], "Takings so far today, after refunds."),
  def("billsPaid", "Bills paid", "Numbers", "S", ["S", "M"], ["report.view"], "How many bills were paid today."),
  def("averageBill", "Average bill", "Numbers", "S", ["S", "M"], ["report.view"], "What a paid bill comes to on average today."),
  def("revenue7", "Revenue, last 7 days", "Numbers", "S", ["S", "M"], ["report.view"], "Sales over the last week, against the week before."),
  def("openOrders", "Open orders", "Numbers", "S", ["S", "M"], [], "Orders taken but not yet paid."),
  def("tablesInUse", "Tables in use", "Numbers", "S", ["S", "M"], [], "How full the floor is right now."),
  def("stockAlerts", "Inventory alerts", "Numbers", "S", ["S", "M"], ["stock.view"], "Stock items at or below their reorder level."),
  def("salesByHour", "Sales by hour", "Charts", "W", ["M", "W", "L"], ["report.view"], "Today's takings hour by hour."),
  def("paymentBreakdown", "Payment breakdown", "Charts", "T", ["T", "M"], ["report.view"], "How customers paid today: cash, card, wallets."),
  def("weekCompare", "This week and last week", "Charts", "L", ["M", "L"], ["report.view"], "Daily sales for 7 days against the 7 days before."),
  def("attention", "Needs attention", "Lists", "L", ["M", "L"], [], "Online orders, guest requests, alerts and low stock waiting for someone."),
  def("openOrdersList", "Open orders", "Lists", "W", ["M", "W", "L"], [], "The orders waiting to be paid, newest first."),
  def("topSelling", "Top selling dishes", "Lists", "T", ["T", "M", "L"], ["report.view"], "Best sellers today."),
  def("lowStockProducts", "Low stock products", "Lists", "M", ["M", "L"], ["stock.view"], "The ingredients that need ordering."),
  def("recentTransactions", "Recent transactions", "Lists", "M", ["M", "L"], ["bills.view"], "The latest paid bills."),
  def("customerOverview", "Customer overview", "Lists", "M", ["M"], ["customer.manage"], "Customers on file, new this week and returning."),
  def("floor", "Floor and staff", "Lists", "T", ["T", "M"], [], "Tables in use and who is working today."),
  def("quickActions", "Quick actions", "Shortcuts", "M", ["M", "L"], [], "The things you do most, one tap away."),
  def("everything", "Everything in one place", "Shortcuts", "L", ["L"], [], "Every screen you can open, grouped."),
];

const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
export const widgetById = (id: string) => BY_ID.get(id);

/** The widgets this person may have on their dashboard. */
export function availableWidgets(who: PermissionSubject): WidgetDef[] {
  return WIDGETS.filter((w) => w.needs.length === 0 || w.needs.some((p) => can(who, p)));
}

/** Where each template puts the widgets when a person has not arranged their own. */
export const TEMPLATE_ORDER: Record<Template, readonly string[]> = {
  // The standard dashboard, as it was before customization: numbers, the three charts, what needs attention, open orders, floor, best sellers, then everything. Cards added later sit at the end, off until switched on.
  CLASSIC: ["salesToday", "billsPaid", "averageBill", "openOrders", "salesByHour", "paymentBreakdown", "weekCompare", "attention", "openOrdersList", "floor", "topSelling", "everything", "tablesInUse", "revenue7", "stockAlerts", "quickActions", "lowStockProducts", "recentTransactions", "customerOverview"],
  MODERN: ["salesToday", "revenue7", "billsPaid", "openOrders", "weekCompare", "salesByHour", "paymentBreakdown", "topSelling", "recentTransactions", "attention", "floor", "quickActions", "customerOverview", "averageBill", "tablesInUse", "stockAlerts", "lowStockProducts", "openOrdersList", "everything"],
  COMPACT: ["attention", "openOrders", "salesToday", "billsPaid", "stockAlerts", "tablesInUse", "quickActions", "openOrdersList", "lowStockProducts", "recentTransactions", "floor", "topSelling", "averageBill", "revenue7", "salesByHour", "paymentBreakdown", "weekCompare", "customerOverview", "everything"],
};

export const TEMPLATE_INFO: Record<Template, { name: string; tagline: string; points: string[] }> = {
  CLASSIC: { name: "Classic Business", tagline: "The traditional ERP dashboard", points: ["KPI cards on top, charts and quick actions below", "Compact and information-rich", "Familiar layout for accountants and owners"] },
  MODERN: { name: "Modern Analytics", tagline: "Spacious and clean", points: ["Large figures and generous spacing", "Rounded cards with soft shadows", "Sales and trends first"] },
  COMPACT: { name: "Compact Operations", tagline: "For a busy counter", points: ["Needs attention, orders and stock first", "Dense, minimal decoration", "Made for cashiers and floor managers"] },
};

/**
 * Widgets a template leaves off until a person turns them on. Classic is the dashboard as it always was, so the cards that came later are
 * off; the tables-in-use number was only ever shown to people who could not see sales.
 */
export function defaultHidden(template: Template, who: PermissionSubject): string[] {
  if (template !== "CLASSIC") return [];
  const later = ["revenue7", "stockAlerts", "quickActions", "lowStockProducts", "recentTransactions", "customerOverview"];
  return can(who, "report.view") ? [...later, "tablesInUse"] : later;
}
