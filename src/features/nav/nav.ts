import { can, type Permission } from "@/server/permissions";
import type { Role } from "@/generated/prisma/enums";

/**
 * Everything a person can open, in sections, with a line saying what it is for. One list feeds the sidebar (as collapsible sections) and the
 * dashboard's "everything" grid, so the two always agree. What a person cannot use is left out, and so are the features a business has not
 * switched on (branch tools, the hukka timer). Pure: counts come in, the list comes out.
 */

export interface NavEntry {
  href: string;
  label: string;
  icon: string;
  /** One short line for the dashboard tiles. */
  description: string;
  badge?: number;
  /** "alert" is red (needs someone now), anything else is amber. */
  badgeTone?: "alert" | "warn";
}

export interface NavSection {
  id: string;
  label: string;
  items: NavEntry[];
}

export interface NavInput {
  role: Role;
  /** Set for a custom role: what the person may do. */
  permissions?: readonly Permission[];
  /** The business works in several branches: shows branch tools. */
  multiBranch: boolean;
  /** The business sells hukka: shows the timer. */
  hukka: boolean;
  counts: Partial<{
    notifications: number;
    guestWaiting: number;
    onlineWaiting: number;
    reservationsWaiting: number;
    hukkaLong: number;
    lowStock: number;
    lowRatings: number;
    ownerAlerts: number;
  }>;
}

export function buildNav(i: NavInput): { home: NavEntry[]; sections: NavSection[] } {
  const c = i.counts;
  const r = { role: i.role, permissions: i.permissions };
  const when = (ok: boolean, e: NavEntry): NavEntry[] => (ok ? [e] : []);

  const home: NavEntry[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard", description: "Today at a glance" },
    { href: "/notifications", label: "Notifications", icon: "bell", description: "Alerts that need someone", badge: c.notifications, badgeTone: "alert" },
  ];

  const sections: NavSection[] = [
    {
      id: "service",
      label: "Service",
      items: [
        ...when(can(r, "order.create") || can(r, "order.edit"), { href: "/orders", label: "Orders", icon: "orders", description: "Tables, takeaway and delivery orders", badge: c.guestWaiting }),
        ...when(can(r, "order.create") && can(r, "order.edit"), { href: "/quick", label: "Quick order", icon: "orders", description: "Fast counter sales, works with no internet" }),
        ...when(can(r, "order.edit"), { href: "/online", label: "Online orders", icon: "orders", description: "Orders customers placed from your link", badge: c.onlineWaiting, badgeTone: "alert" }),
        ...when(can(r, "kitchen.update") || can(r, "order.edit"), { href: "/kitchen", label: "Kitchen", icon: "kitchen", description: "Tickets for the kitchen and bar" }),
        ...when(can(r, "order.edit"), { href: "/reservations", label: "Reservations", icon: "tables", description: "Table bookings", badge: c.reservationsWaiting, badgeTone: "alert" }),
        ...when(can(r, "order.edit") && i.hukka, { href: "/hukka", label: "Hukka timer", icon: "clock", description: "Time each hukka and count coils", badge: c.hukkaLong, badgeTone: "alert" }),
        ...when(can(r, "order.edit"), { href: "/dispatch", label: "Dispatch", icon: "truck", description: "Give deliveries to riders" }),
      ],
    },
    {
      id: "menu",
      label: "Menu and stock",
      items: [
        ...when(can(r, "menu.manage"), { href: "/menu", label: "Menu", icon: "menu", description: "Dishes, prices, photos and extras" }),
        ...when(can(r, "menu.manage"), { href: "/deals", label: "Deals", icon: "campaigns", description: "Happy hour and combos" }),
        ...when(can(r, "stock.view"), { href: "/stock", label: "Stock", icon: "stock", description: "Ingredients, recipes, purchase orders", badge: c.lowStock, badgeTone: "warn" }),
        ...when(can(r, "floor.manage"), { href: "/tables", label: "Tables and floor", icon: "tables", description: "Tables, areas, floor plan, QR codes" }),
        ...when(can(r, "floor.manage"), { href: "/delivery", label: "Delivery pricing", icon: "truck", description: "Zones and fees" }),
      ],
    },
    {
      id: "customers",
      label: "Customers",
      items: [
        ...when(can(r, "customer.manage"), { href: "/customers", label: "Customers", icon: "customers", description: "Who they are and what they buy" }),
        ...when(can(r, "campaign.manage"), { href: "/campaigns", label: "Campaigns", icon: "campaigns", description: "Messages and offers" }),
        ...when(can(r, "campaign.manage"), { href: "/stamps", label: "Stamp cards", icon: "feedback", description: "Every Nth dish free" }),
        ...when(can(r, "feedback.view"), { href: "/feedback", label: "Feedback", icon: "feedback", description: "Ratings and comments", badge: c.lowRatings, badgeTone: "alert" }),
      ],
    },
    {
      id: "money",
      label: "Money",
      items: [
        ...when(can(r, "report.view"), { href: "/reports", label: "Reports", icon: "reports", description: "Daily sales and closing the day" }),
        ...when(can(r, "bills.view"), { href: "/bills", label: "Bills", icon: "bills", description: "Paid bills, reprints and refunds" }),
        ...when(can(r, "drawer.use") || can(r, "drawer.review"), { href: "/drawer", label: "Cash drawer", icon: "bills", description: "Float, cash in and out, and the count at handover" }),
        ...when(can(r, "books.view"), { href: "/accounting", label: "Accounts", icon: "reports", description: "Books, VAT and reports for your accountant" }),
      ],
    },
    {
      id: "team",
      label: "Team",
      items: [
        ...when(can(r, "staff.manage"), { href: "/staff", label: "Staff", icon: "staff", description: "People, roles and logins" }),
        ...when(i.role !== "ACCOUNTANT", { href: "/time", label: "My time", icon: "clock", description: "Clock in and out" }),
        ...when(i.role !== "ACCOUNTANT", { href: "/roster", label: can(r, "time.manage") ? "Roster" : "My shifts", icon: "clock", description: can(r, "time.manage") ? "Who works when" : "When you work" }),
        ...when(can(r, "drawer.use") || can(r, "payroll.manage"), { href: "/tips", label: "Tips", icon: "feedback", description: "Record tips and share them out" }),
        ...when(can(r, "time.manage"), { href: "/attendance", label: "Attendance", icon: "staff", description: "Who is in today" }),
        ...when(can(r, "payroll.manage"), { href: "/payroll", label: "Payroll", icon: "bills", description: "Pay for hours worked" }),
      ],
    },
    {
      id: "settings",
      label: "Settings",
      items: [
        { href: "/settings", label: "Settings", icon: "extras", description: "Business setup, dashboard and appearance" },
        { href: "/settings/dashboard", label: "Dashboard settings", icon: "layout", description: "Arrange cards, pick a layout, show or hide widgets" },
        { href: "/settings/appearance", label: "Appearance & branding", icon: "palette", description: "Light or dark, theme colour and business logo" },
        ...when(can(r, "owner.control"), { href: "/owner", label: "Owner control", icon: "reports", description: "Daily summary and things to check", badge: c.ownerAlerts, badgeTone: "alert" }),
        ...when(can(r, "owner.control"), { href: "/settings/profile", label: "Business profile", icon: "extras", description: "Name, address, logo and bill details" }),
        ...when(can(r, "owner.control"), { href: "/settings/activity", label: "Activity log", icon: "reports", description: "Who did what, and when" }),
        ...when(can(r, "menu.manage"), { href: "/settings/trash", label: "Trash", icon: "menu", description: "Put back dishes you deleted" }),
        ...when(can(r, "owner.control"), { href: "/settings/payments", label: "Payments", icon: "bills", description: "eSewa, Khalti and other ways customers pay" }),
        ...when(can(r, "print.manage"), { href: "/printing", label: "Printing", icon: "bills", description: "Receipt and kitchen printers" }),
        ...when(can(r, "owner.control"), { href: "/customer-os", label: "Customer OS", icon: "customers", description: "Link to your customer and loyalty system" }),
        ...when(can(r, "branch.manage") && i.multiBranch, { href: "/branches", label: "Branches", icon: "branches", description: "Your locations" }),
      ],
    },
  ];

  return { home, sections: sections.filter((s) => s.items.length > 0) };
}

/** Which section holds a page, so the sidebar can keep that one open. */
export function sectionOf(sections: NavSection[], path: string): string | null {
  const hit = sections.find((s) => s.items.some((i) => path === i.href || path.startsWith(`${i.href}/`)));
  return hit?.id ?? null;
}
