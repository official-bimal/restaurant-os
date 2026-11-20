import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import type { FetchLike } from "../gateways";
import { providerLabel } from "../gateways";
import { createIntent, guestPayCtx, refreshByGuest, resolveProvider } from "./service";

/**
 * Paying at the table. A guest who scanned the table's QR can pay their own bill with eSewa or Khalti from their phone. They are taken to the
 * service, the software asks the service whether it was really paid, and the bill then closes by itself (see completeGuestPayment). Nothing
 * here trusts the guest's phone: the amount is worked out on the server, and a bill is only ever paid for what it came to when they started.
 */

export interface GuestPayInfo {
  /** The owner has switched paying at the table on. */
  enabled: boolean;
  methods: { id: "ESEWA" | "KHALTI"; label: string }[];
  /** A payment the guest has started and not finished, per bill, so they can carry on with it. */
  inProgress: { orderId: string; token: string; label: string }[];
  /** The latest order is still waiting for the staff to accept, so the bill is not final. */
  waitingForStaff: boolean;
}

/** The bills still open at a table. */
async function openOrderIds(businessId: string, tableId: string): Promise<string[]> {
  return (await db.order.findMany({ where: { businessId, tableId, status: { in: ["OPEN", "SERVED"] } }, select: { id: true } })).map((o) => o.id);
}

const OFF: GuestPayInfo = { enabled: false, methods: [], inProgress: [], waitingForStaff: false };

/** What to offer a guest at a table. Nothing unless the owner has switched it on and eSewa or Khalti is ready. */
export async function guestPayInfo(businessId: string, tableId: string): Promise<GuestPayInfo> {
  const biz = await db.business.findUnique({ where: { id: businessId }, select: { guestPayEnabled: true } });
  if (!biz?.guestPayEnabled) return OFF;
  const methods: GuestPayInfo["methods"] = [];
  for (const id of ["ESEWA", "KHALTI"] as const) if (await resolveProvider(businessId, id)) methods.push({ id, label: providerLabel(id) });
  if (methods.length === 0) return OFF;
  const orderIds = await openOrderIds(businessId, tableId);
  const [waiting, live] = await Promise.all([
    db.guestSubmission.count({ where: { businessId, status: "PENDING", tableId } }),
    db.paymentIntent.findMany({ where: { businessId, orderId: { in: orderIds }, status: { in: ["CREATED", "PENDING"] }, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);
  const seen = new Set<string>();
  const inProgress = live.filter((i) => (seen.has(i.orderId) ? false : (seen.add(i.orderId), true))).map((i) => ({ orderId: i.orderId, token: i.token, label: providerLabel(i.provider) }));
  return { enabled: true, methods, inProgress, waitingForStaff: waiting > 0 };
}

/** A guest starts paying one bill at their table. Returns the token of the pay page to send them to. */
export async function startGuestPayment(
  gc: { businessId: string; tableId: string; sessionId: string },
  orderId: string,
  provider: string,
  baseUrl: string,
  deps: { fetch?: FetchLike } = {},
): Promise<{ token: string }> {
  if (provider !== "ESEWA" && provider !== "KHALTI") throw new DomainError("Choose eSewa or Khalti.");
  const { businessId } = gc;
  const biz = await db.business.findUnique({ where: { id: businessId }, select: { guestPayEnabled: true } });
  if (!biz?.guestPayEnabled) throw new DomainError("Paying from your phone is not available here. Please ask the staff.");
  const session = await db.tableSession.findFirst({ where: { id: gc.sessionId, businessId, tableId: gc.tableId, closedAt: null }, select: { id: true } });
  if (!session) throw new DomainError("This table's session has ended. Scan the QR code again.");
  // Only a bill at this guest's own table, and only one that is still open and has something on it.
  const order = await db.order.findFirst({
    where: { id: orderId, businessId, tableId: gc.tableId, status: { in: ["OPEN", "SERVED"] }, invoice: null },
    select: { id: true, branchId: true, items: { where: { status: { not: "CANCELLED" } }, select: { id: true } } },
  });
  if (!order) throw new DomainError("That bill is not open any more.");
  if (order.items.length === 0) throw new DomainError("There is nothing on this bill yet.");
  const waiting = await db.guestSubmission.count({ where: { businessId, status: "PENDING", tableId: gc.tableId } });
  if (waiting > 0) throw new DomainError("Your latest order is waiting for the staff to accept it. You can pay once they have.");
  // Each start asks the payment service for a new payment, so the number of tries is limited.
  const recent = await db.paymentIntent.count({ where: { businessId, orderId, byGuest: true, createdAt: { gt: new Date(Date.now() - 5 * 60_000) } } });
  if (recent >= 5) throw new DomainError("Too many tries. Please wait a few minutes or ask the staff.");
  const ctx = guestPayCtx(businessId, order.branchId);
  const intent = await createIntent(ctx, orderId, provider, { discountPercent: 0 }, baseUrl, deps, { byGuest: true });
  await db.$transaction((tx) => audit(tx, ctx, "payments.guestStart", "PaymentIntent", intent.id, { provider }));
  return { token: intent.token };
}

const lastCheck = new Map<string, number>();

/**
 * A guest who paid may never come back to our page (they closed the browser), so while their page is open we ask the service about their
 * unfinished payments, at most every 8 seconds each. A confirmed payment closes the bill (see completeGuestPayment).
 */
export async function checkGuestPayments(gc: { businessId: string; tableId: string }, deps: { fetch?: FetchLike } = {}) {
  const live = await db.paymentIntent.findMany({
    where: { businessId: gc.businessId, byGuest: true, orderId: { in: await openOrderIds(gc.businessId, gc.tableId) }, status: { in: ["PENDING", "CREATED"] }, consumedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, status: true },
    take: 5,
  });
  const now = Date.now();
  for (const i of live) {
    // A payment nobody has opened the pay page for has nothing to check yet.
    if (i.status === "CREATED") continue;
    if (now - (lastCheck.get(i.id) ?? 0) < 8_000) continue;
    lastCheck.set(i.id, now);
    await refreshByGuest(i.id, deps).catch(() => undefined);
  }
}

/** The owner turns paying at the table on or off. */
export async function setGuestPay(ctx: TenantContext, on: boolean) {
  if (!can(ctx, "owner.control") && !can(ctx, "branch.manage")) throw new DomainError("Only the owner can change this.");
  if (on) {
    let ready = false;
    for (const id of ["ESEWA", "KHALTI"] as const) if (await resolveProvider(ctx.businessId, id)) ready = true;
    if (!ready) throw new DomainError("Switch on eSewa or Khalti first (below), then guests can pay with it.");
  }
  await db.$transaction(async (tx) => {
    await tx.business.update({ where: { id: ctx.businessId }, data: { guestPayEnabled: on } });
    await audit(tx, ctx, "payments.guestPay", "Business", ctx.businessId, { on });
  });
}
