import type { Role } from "@/generated/prisma/enums";
import { DomainError } from "@/server/errors";
import { isPermission, RESERVED_PERMISSIONS, type Permission } from "@/server/permissions";

/** Pure: how permissions are shown to an owner, and checking a custom role before it is saved. */

export const ROLE_COLORS = ["indigo", "emerald", "amber", "rose", "sky", "violet", "stone"] as const;
export type RoleColor = (typeof ROLE_COLORS)[number];

/** Built-in roles a custom role can be based on (the base decides which kind of screen the person gets). */
export const BASE_ROLES: readonly Role[] = ["MANAGER", "CASHIER", "WAITER", "KITCHEN", "RIDER", "ACCOUNTANT"];

export const PERMISSION_GROUPS: { title: string; items: { key: Permission; label: string }[] }[] = [
  {
    title: "Orders and service",
    items: [
      { key: "order.create", label: "Start orders" },
      { key: "order.edit", label: "Add and change items on orders" },
      { key: "order.cancelItem", label: "Cancel an item" },
      { key: "order.restructure", label: "Move, merge and split orders" },
      { key: "order.void", label: "Void an order" },
      { key: "kitchen.update", label: "Update kitchen tickets" },
      { key: "delivery.ride", label: "Ride deliveries (rider page)" },
      { key: "rider.settle", label: "Settle cash with riders" },
    ],
  },
  {
    title: "Bills and money",
    items: [
      { key: "bill.checkout", label: "Take payment and check out" },
      { key: "bill.refund", label: "Refund a bill" },
      { key: "bills.view", label: "See paid bills and reprint" },
      { key: "drawer.use", label: "Use the cash drawer and record tips" },
      { key: "drawer.review", label: "Review drawer counts and differences" },
      { key: "supplier.pay", label: "Pay suppliers" },
    ],
  },
  {
    title: "Menu, stock and floor",
    items: [
      { key: "menu.manage", label: "Change the menu, deals and Trash" },
      { key: "stock.view", label: "See stock" },
      { key: "stock.manage", label: "Change stock and purchase orders" },
      { key: "stock.waste", label: "Record waste" },
      { key: "floor.manage", label: "Change tables and the floor plan" },
    ],
  },
  {
    title: "Customers",
    items: [
      { key: "customer.use", label: "Attach a customer to a bill" },
      { key: "customer.manage", label: "Manage customers" },
      { key: "campaign.manage", label: "Campaigns and stamp cards" },
      { key: "feedback.view", label: "See feedback" },
      { key: "message.send", label: "Send messages" },
    ],
  },
  {
    title: "Reports and books",
    items: [
      { key: "report.view", label: "See reports" },
      { key: "day.close", label: "Close the day" },
      { key: "day.reopen", label: "Reopen a closed day" },
      { key: "books.view", label: "See the accounts" },
      { key: "books.manage", label: "Post and change accounting entries" },
    ],
  },
  {
    title: "Team and settings",
    items: [
      { key: "time.manage", label: "Roster and attendance" },
      { key: "payroll.manage", label: "Payroll" },
      { key: "branch.manage", label: "Branches and several-branch setting" },
      { key: "print.manage", label: "Printing settings" },
      { key: "display.manage", label: "Customer display settings" },
    ],
  },
];

/** Every permission a custom role may hold. */
export const GRANTABLE: readonly Permission[] = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key)).filter((k) => !RESERVED_PERMISSIONS.includes(k));

export interface RoleInput {
  name: string;
  color: string;
  baseRole: string;
  permissions: string[];
}

export function cleanRole(i: RoleInput) {
  const name = i.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 30) throw new DomainError("Give the role a name of 2 to 30 letters.");
  if (!(ROLE_COLORS as readonly string[]).includes(i.color)) throw new DomainError("Choose one of the colours.");
  if (!(BASE_ROLES as readonly string[]).includes(i.baseRole)) throw new DomainError("Choose which kind of role this is based on.");
  const perms = [...new Set(i.permissions)].filter((p): p is Permission => isPermission(p) && GRANTABLE.includes(p));
  if (perms.length === 0) throw new DomainError("Tick at least one thing this role may do.");
  return { name, color: i.color, baseRole: i.baseRole as Role, permissions: perms };
}
