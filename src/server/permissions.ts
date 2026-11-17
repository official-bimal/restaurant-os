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
  | "owner.control";

const MATRIX: Record<Role, readonly Permission[]> = {
  OWNER: ["order.create", "order.edit", "order.cancelItem", "kitchen.update", "bill.checkout", "menu.manage", "floor.manage", "staff.manage", "customer.use", "customer.manage", "order.restructure", "order.void", "bill.refund", "bills.view", "report.view", "day.close", "day.reopen", "feedback.view", "stock.view", "stock.manage", "stock.waste", "campaign.manage", "branch.manage", "rider.settle", "supplier.pay", "time.manage", "payroll.manage", "message.send", "print.manage", "owner.control"],
  MANAGER: ["order.create", "order.edit", "order.cancelItem", "kitchen.update", "bill.checkout", "menu.manage", "floor.manage", "staff.manage", "customer.use", "customer.manage", "order.restructure", "order.void", "bill.refund", "bills.view", "report.view", "day.close", "feedback.view", "stock.view", "stock.manage", "stock.waste", "campaign.manage", "rider.settle", "supplier.pay", "time.manage", "print.manage"],
  CASHIER: ["order.create", "order.edit", "bill.checkout", "customer.use", "order.restructure", "bills.view", "rider.settle"],
  WAITER: ["order.create", "order.edit"],
  KITCHEN: ["kitchen.update", "stock.view", "stock.waste"],
  // A rider sees only the deliveries assigned to them, through their own page.
  RIDER: ["delivery.ride"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

const ROLE_RANK: Record<Role, number> = { OWNER: 4, MANAGER: 3, CASHIER: 2, WAITER: 1, KITCHEN: 0, RIDER: 0 };

/**
 * Who may create, change or remove whom. Owners manage everyone; managers manage
 * only roles below manager. Nobody else manages staff.
 */
export function canManageRole(actor: Role, target: Role): boolean {
  if (!can(actor, "staff.manage")) return false;
  if (actor === "OWNER") return true;
  return ROLE_RANK[target] < ROLE_RANK[actor];
}
