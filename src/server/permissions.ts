import type { Role } from "@/generated/prisma/enums";

/** Small, explicit permission set (the research found ~90 permissions to be unmanageable). */
export type Permission =
  | "order.create"
  | "order.edit"
  | "order.cancelItem"
  | "kitchen.update"
  | "bill.checkout"
  | "menu.manage"
  | "floor.manage"
  | "staff.manage"
  | "customer.use"
  | "customer.manage"
  | "order.restructure"
  | "order.void"
  | "bill.refund"
  | "bills.view"
  | "report.view"
  | "day.close"
  | "day.reopen"
  | "feedback.view"
  | "stock.view"
  | "stock.manage"
  | "stock.waste"
  | "campaign.manage"
  | "branch.manage"
  | "delivery.ride"
  | "rider.settle"
  | "supplier.pay"
  | "time.manage"
  | "payroll.manage"
  | "message.send"
  | "print.manage"
  | "books.view"
  | "books.manage"
  | "drawer.use"
  | "drawer.review"
  | "display.manage"
  | "owner.control";

const MATRIX: Record<Role, readonly Permission[]> = {
  OWNER: ["order.create", "order.edit", "order.cancelItem", "kitchen.update", "bill.checkout", "menu.manage", "floor.manage", "staff.manage", "customer.use", "customer.manage", "order.restructure", "order.void", "bill.refund", "bills.view", "report.view", "day.close", "day.reopen", "feedback.view", "stock.view", "stock.manage", "stock.waste", "campaign.manage", "branch.manage", "rider.settle", "supplier.pay", "time.manage", "payroll.manage", "message.send", "print.manage", "books.view", "books.manage", "drawer.use", "drawer.review", "display.manage", "owner.control"],
  MANAGER: ["order.create", "order.edit", "order.cancelItem", "kitchen.update", "bill.checkout", "menu.manage", "floor.manage", "staff.manage", "customer.use", "customer.manage", "order.restructure", "order.void", "bill.refund", "bills.view", "report.view", "day.close", "feedback.view", "stock.view", "stock.manage", "stock.waste", "campaign.manage", "rider.settle", "supplier.pay", "time.manage", "print.manage", "books.view", "drawer.use", "drawer.review", "display.manage"],
  CASHIER: ["order.create", "order.edit", "bill.checkout", "customer.use", "order.restructure", "bills.view", "rider.settle", "drawer.use"],
  WAITER: ["order.create", "order.edit"],
  KITCHEN: ["kitchen.update", "stock.view", "stock.waste"],
  // An accountant reads the books, bills and reports and downloads them; nothing else, and nothing can be changed.
  ACCOUNTANT: ["report.view", "bills.view", "books.view"],
  // A rider sees only the deliveries assigned to them, through their own page.
  RIDER: ["delivery.ride"],
};

/**
 * Who is asking: a plain role, or a person (the tenant context) who may have a custom role. A custom role's ticked
 * permissions replace the ones its base role would give.
 */
export type PermissionSubject = Role | { role: Role; permissions?: readonly Permission[] };

export function can(who: PermissionSubject, permission: Permission): boolean {
  if (typeof who === "string") return MATRIX[who].includes(permission);
  return (who.permissions ?? MATRIX[who.role]).includes(permission);
}

/** What a built-in role gives, used to start a custom role from. */
export function basePermissions(role: Role): readonly Permission[] {
  return MATRIX[role];
}

/** Every permission there is. */
export const ALL_PERMISSIONS: readonly Permission[] = [...new Set(Object.values(MATRIX).flat())];

/** Left out of custom roles: only built-in owners and managers hold these, so a role can never make someone an owner. */
export const RESERVED_PERMISSIONS: readonly Permission[] = ["owner.control", "staff.manage"];

export function isPermission(v: string): v is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(v);
}

const ROLE_RANK: Record<Role, number> = { OWNER: 4, MANAGER: 3, CASHIER: 2, WAITER: 1, KITCHEN: 0, RIDER: 0, ACCOUNTANT: 0 };

/**
 * Who may create, change or remove whom. Owners manage everyone; managers manage
 * only roles below manager. Nobody else manages staff.
 */
export function canManageRole(actor: Role, target: Role): boolean {
  if (!can(actor, "staff.manage")) return false;
  if (actor === "OWNER") return true;
  return ROLE_RANK[target] < ROLE_RANK[actor];
}
