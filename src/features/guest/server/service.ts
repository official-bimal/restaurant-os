import { autoQueueKitchenSlip } from "@/features/printing/server/queue";
import { dishRatingsFor } from "@/features/feedback/server/service";
import { BEST_SELLER_DAYS, pickBestSellers } from "@/features/guest/best-sellers";
import { publishLive } from "@/server/live";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit, type Tx } from "@/server/audit";
import { Prisma } from "@/generated/prisma/client";
import type { RequestKind } from "@/generated/prisma/enums";
import { calculateBill } from "@/features/billing/calc";
import { syncOrderStatus } from "@/features/orders/server/sync";
import { normalizePhone, maskPhone } from "@/server/phone";
import { upsertCustomer } from "@/features/loyalty/server/customers";
import { pointsEarned } from "@/features/loyalty/points";
import { settingsFromBusiness } from "@/features/loyalty/server/checkout";
import { orderableItemIds } from "@/features/menu/server/menu-sets";
import { addOnNames, groupRulesForMenu, priceAddOns } from "@/features/menu/server/pricing";
import { pushToTeam } from "@/features/notifications/server/push";
import { branchMenuOverrides, effectiveItem, hiddenDishIds } from "@/features/menu/server/branch-menu";

/**
 * Guest (QR) ordering.
 *
 * Trust model: the table's secret QR token proves the guest is at the table; it only
 * lets them open a sitting (TableSession). Everything after that is bound to that
 * sitting, and the sitting dies at checkout, so an old photo of the QR cannot order
 * against a bill that has been paid. Guest actions never take a businessId or tableId
 * from the browser; both come from the sitting.
 */

/**
 * Dishes a guest may order from their phone right now: those in the active menu set of the
 * table's own branch (the whole menu when no set is active there).
 */
async function guestOrderable(client: Tx | typeof db, businessId: string, tableId: string) {
  const table = await client.diningTable.findFirstOrThrow({ where: { id: tableId, businessId }, select: { branchId: true } });
  const [orderable, overrides, hiddenDishes] = await Promise.all([
    orderableItemIds(client, businessId, table.branchId),
    branchMenuOverrides(client, businessId, table.branchId),
    hiddenDishIds(client, businessId, table.branchId),
  ]);
  const allowed = (id: string) => (!orderable || orderable.has(id)) && (overrides.get(id)?.available ?? true) && !hiddenDishes.has(id);
  /** The price at this table's branch: its own price for the dish if it has one, else the shared price. */
  const priceOf = (id: string, shared: number) => overrides.get(id)?.price ?? shared;
  return Object.assign(allowed, { priceOf, branchId: table.branchId });
}

/** Tell the floor staff of the table's branch, even if their app is closed. Never blocks the guest. */
async function alertStaff(gc: { businessId: string; tableId: string }, text: (label: string) => { title: string; body: string; tag: string }) {
  try {
    const table = await db.diningTable.findFirst({ where: { id: gc.tableId, businessId: gc.businessId }, select: { label: true, branchId: true } });
    if (!table) return;
    const p = text(table.label);
    publishLive({ businessId: gc.businessId, branchId: table.branchId, topic: "guest" });
    await pushToTeam({ businessId: gc.businessId, branchId: table.branchId, permission: "order.edit", payload: { ...p, url: "/orders" } });
  } catch {
    // an alert that fails must not fail the guest's order
  }
}

export interface GuestContext {
  businessId: string;
  tableId: string;
  sessionId: string;
}

export const LIMITS = {
  linesPerOrder: 30,
  quantityPerLine: 20,
  pendingPerSession: 3,
  pendingPerTable: 5,
  noteLength: 120,
} as const;

// --- guest side ----------------------------------------------------------

/** Public lookup by the secret QR token. Returns only what the landing page may show. */
export async function lookupTable(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const table = await db.diningTable.findUnique({
    where: { publicToken: token },
    include: { business: { select: { name: true, guestOrderingEnabled: true } } },
  });
  if (!table) return null;
  return {
    tableId: table.id,
    businessId: table.businessId,
    tableLabel: table.label,
    businessName: table.business.name,
    enabled: table.business.guestOrderingEnabled,
  };
}

/** Join the table's open sitting, or start one. Everyone at the table shares it. */
export async function openSession(token: string): Promise<GuestContext> {
  const t = await lookupTable(token);
  if (!t) throw new DomainError("This QR code is not valid any more. Please ask the staff.");
  if (!t.enabled) throw new DomainError("Ordering from your phone is not available here. Please ask the staff.");
  return db.$transaction(async (tx) => {
    // Serialise concurrent first-scans so a table never gets two open sittings.
    await tx.$queryRaw`SELECT id FROM "DiningTable" WHERE id = ${t.tableId} AND "businessId" = ${t.businessId} FOR UPDATE`;
    const open = await tx.tableSession.findFirst({
      where: { businessId: t.businessId, tableId: t.tableId, closedAt: null },
      orderBy: { openedAt: "asc" },
    });
    const session =
      open ?? (await tx.tableSession.create({ data: { businessId: t.businessId, tableId: t.tableId } }));
    return { businessId: t.businessId, tableId: t.tableId, sessionId: session.id };
  });
}

/** Re-check the guest's cookie claims against the database. Null once the sitting is closed. */
export async function resolveGuest(claims: { sessionId: string; tableId: string } | null) {
  if (!claims) return null;
  const session = await db.tableSession.findFirst({
    where: { id: claims.sessionId, tableId: claims.tableId, closedAt: null },
    include: { table: { include: { business: true } } },
  });
  if (!session || !session.table.business.guestOrderingEnabled) return null;
  const ctx: GuestContext = { businessId: session.businessId, tableId: session.tableId, sessionId: session.id };
  return { ctx, tableLabel: session.table.label, business: session.table.business };
}

export interface SubmitInput {
  items: { menuItemId: string; quantity: number; note?: string; addOnIds?: string[] }[];
  note?: string;
  idempotencyKey: string;
}

export async function submitOrder(gc: GuestContext, input: SubmitInput) {
  const { businessId } = gc;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.idempotencyKey)) throw new DomainError("Something went wrong. Please try again.");

  // Same key again (double tap, retry after a bad connection): return the first result.
  const existing = await db.guestSubmission.findUnique({
    where: { businessId_idempotencyKey: { businessId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) {
    if (existing.sessionId !== gc.sessionId) throw new DomainError("Something went wrong. Please try again.");
    return existing;
  }

  if (input.items.length === 0) throw new DomainError("Your cart is empty.");
  if (input.items.length > LIMITS.linesPerOrder) throw new DomainError("That is a lot of dishes. Please split it into two orders.");
  for (const i of input.items) {
    if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > LIMITS.quantityPerLine) {
      throw new DomainError(`Choose between 1 and ${LIMITS.quantityPerLine} of each dish.`);
    }
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const session = await tx.tableSession.findFirst({
        where: { id: gc.sessionId, businessId, tableId: gc.tableId, closedAt: null },
        include: { business: true },
      });
      if (!session) throw new DomainError("This table's session has ended. Scan the QR code again to start a new order.");

      const mine = await tx.guestSubmission.count({ where: { businessId, sessionId: gc.sessionId, status: "PENDING" } });
      const table = await tx.guestSubmission.count({ where: { businessId, tableId: gc.tableId, status: "PENDING" } });
      if (mine >= LIMITS.pendingPerSession || table >= LIMITS.pendingPerTable) {
        throw new DomainError("Your earlier orders are still waiting for the staff. Please wait a moment.");
      }

      const ids = [...new Set(input.items.map((i) => i.menuItemId))];
      const menu = await tx.menuItem.findMany({ where: { businessId, id: { in: ids }, available: true } });
      const byId = new Map(menu.map((m) => [m.id, m]));
      const missing = ids.filter((id) => !byId.has(id));
      const allowed = await guestOrderable(tx, businessId, gc.tableId);
      if (missing.length > 0 || ids.some((id) => !allowed(id))) {
        throw new DomainError("Some dishes are no longer available. Please refresh the menu.");
      }

      const sub = await tx.guestSubmission.create({
        data: {
          businessId,
          tableId: gc.tableId,
          sessionId: gc.sessionId,
          idempotencyKey: input.idempotencyKey,
          note: input.note?.trim().slice(0, LIMITS.noteLength) || null,
        },
      });
      const rows = [];
      for (const i of input.items) {
        const m = byId.get(i.menuItemId)!;
        // The choices are checked against what the dish offers, and priced here, never from the phone.
        const { chosen, extra } = await priceAddOns(tx, businessId, m.id, i.addOnIds ?? [], allowed.branchId);
        rows.push({
          businessId,
          submissionId: sub.id,
          menuItemId: m.id,
          name: m.name,
          unitPrice: allowed.priceOf(m.id, m.price) + extra,
          quantity: i.quantity,
          note: i.note?.trim().slice(0, LIMITS.noteLength) || null,
          addOnIds: chosen.map((c) => c.id),
        });
      }
      await tx.guestSubmissionItem.createMany({ data: rows });

      if (!session.business.requireOrderApproval) {
        await acceptInTx(tx, businessId, sub.id, null);
        return tx.guestSubmission.findUniqueOrThrow({ where: { id: sub.id } });
      }
      return sub;
    });
    void alertStaff(gc, (label) => ({ title: `Table ${label} sent an order`, body: "Open Orders to accept it.", tag: `order-${gc.tableId}` }));
    // When orders skip staff approval they are real orders already: queue the kitchen slip now.
    if (result.orderId) void queueSlipForSubmission(businessId, result.id, null);
    return result;
  } catch (e) {
    // Two identical taps raced: the loser returns the winner's submission.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await db.guestSubmission.findUnique({
        where: { businessId_idempotencyKey: { businessId, idempotencyKey: input.idempotencyKey } },
      });
      if (again && again.sessionId === gc.sessionId) return again;
    }
    throw e;
  }
}

export async function requestService(gc: GuestContext, kind: RequestKind) {
  const { businessId } = gc;
  let isNew = false;
  const result = await db.$transaction(async (tx) => {
    const session = await tx.tableSession.findFirst({
      where: { id: gc.sessionId, businessId, tableId: gc.tableId, closedAt: null },
    });
    if (!session) throw new DomainError("This table's session has ended. Scan the QR code again.");

    const open = await tx.serviceRequest.findFirst({
      where: { businessId, tableId: gc.tableId, kind, status: "OPEN" },
    });
    if (open) return open; // already asked; no pile-up of identical requests
    isNew = true;

    if (kind === "REQUEST_BILL") {
      const order = await tx.order.findFirst({
        where: { businessId, tableId: gc.tableId, status: { in: ["OPEN", "SERVED"] } },
      });
      if (!order) throw new DomainError("There is nothing to bill yet.");
      await tx.diningTable.update({
        where: { businessId_id: { businessId, id: gc.tableId } },
        data: { state: "BILL_REQUESTED" },
      });
    }
    return tx.serviceRequest.create({
      data: { businessId, tableId: gc.tableId, sessionId: gc.sessionId, kind },
    });
  });
  if (isNew) {
    const what = { CALL_WAITER: "is calling a waiter", REQUEST_BILL: "asked for the bill", WATER: "asked for water" }[kind];
    void alertStaff(gc, (label) => ({ title: `Table ${label} ${what}`, body: "Open Orders to see it.", tag: `req-${gc.tableId}-${kind}` }));
  }
  return result;
}

/** Everything the guest page shows, for this sitting only. */
export async function getGuestView(gc: GuestContext) {
  const { businessId } = gc;
  const allowedItem = await guestOrderable(db, businessId, gc.tableId);
  const [rawMenu, submissions, requests, orders, business, session] = await Promise.all([
    db.menuCategory.findMany({
      where: { businessId },
      include: { items: { where: { available: true }, orderBy: { name: "asc" }, include: { image: { select: { updatedAt: true } } } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.guestSubmission.findMany({
      where: { businessId, sessionId: gc.sessionId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
    db.serviceRequest.findMany({
      where: { businessId, tableId: gc.tableId, status: "OPEN" },
      orderBy: { createdAt: "asc" },
    }),
    // A table can have several open bills after a split; the guests are one party.
    db.order.findMany({
      where: { businessId, tableId: gc.tableId, status: { in: ["OPEN", "SERVED"] } },
      include: { items: { orderBy: { createdAt: "asc" }, include: { addOns: true } } },
      orderBy: { number: "asc" },
    }),
    db.business.findUniqueOrThrow({ where: { id: businessId } }),
    db.tableSession.findFirst({ where: { id: gc.sessionId, businessId }, include: { customer: { select: { phone: true } } } }),
  ]);

  // Same calculation staff use for each bill, so the numbers cannot disagree. Each bill is
  // rounded on its own because each becomes its own invoice.
  const settings = settingsFromBusiness(business);
  const bills = orders
    .map((o) => {
      const active = o.items.filter((i) => i.status !== "CANCELLED");
      if (active.length === 0) return null;
      const totals = calculateBill(
        active.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity, complimentary: i.complimentary })),
        {
          discount: { kind: "none" },
          serviceChargeBps: business.serviceChargeBps,
          vatMode: business.vatMode,
          vatBps: business.vatBps,
          vatAppliesToServiceCharge: business.vatAppliesToServiceCharge,
          roundToRupee: business.roundToRupee,
        },
      );
      return { number: o.number, total: totals.grandTotal, points: pointsEarned(totals.grandTotal, settings) };
    })
    .filter((b): b is { number: number; total: number; points: number } => b !== null);
  const estimate = bills.length ? { grandTotal: bills.reduce((n, b) => n + b.total, 0) } : null;
  const orderItems = orders.flatMap((o) => o.items);

  // Deliberately no balance, name or history: the number is unverified, so we must not
  // reveal what we know about whoever owns it.
  const loyalty = {
    enabled: settings.enabled,
    maskedPhone: session?.customer ? maskPhone(session.customer.phone) : null,
    pointsToEarn: bills.reduce((n, b) => n + b.points, 0),
  };

  // Each dish carries the choices a guest can make on it (size, extras), with their prices.
  const rules = await groupRulesForMenu(db, businessId, allowedItem.branchId);
  const menu = rawMenu.map((c) => ({
    ...c,
    items: c.items.filter((i) => allowedItem(i.id)).map((i) => ({ ...i, price: allowedItem.priceOf(i.id, i.price), groups: rules.get(i.id) ?? [] })),
  }));
  // Dishes this branch sells most, from the last 30 days of paid bills. Only the names are ever shown to guests.
  const since = new Date(Date.now() - BEST_SELLER_DAYS * 24 * 60 * 60 * 1000);
  const soldRows = !business.guestBestSellers ? [] : await db.$queryRaw<{ menuItemId: string; quantity: number }[]>`
    SELECT oi."menuItemId", SUM(oi."quantity")::int AS quantity
    FROM "OrderItem" oi
    JOIN "Order" o ON o."id" = oi."orderId" AND o."businessId" = oi."businessId"
    JOIN "Invoice" inv ON inv."orderId" = o."id" AND inv."businessId" = o."businessId"
    WHERE oi."businessId" = ${businessId}
      AND o."branchId" = ${allowedItem.branchId}
      AND oi."status" <> 'CANCELLED' AND oi."complimentary" = false
      AND inv."createdAt" >= ${since}
    GROUP BY oi."menuItemId"`;
  // Switched off in the settings: skip the work and show nothing.
  const bestSellerIds = !business.guestBestSellers ? [] : pickBestSellers(
    soldRows.map((r) => ({ menuItemId: r.menuItemId, quantity: Number(r.quantity) })),
    new Set(menu.flatMap((c) => c.items.map((i) => i.id))),
  );
  const dishRatings = await dishRatingsFor(businessId, menu.flatMap((c) => c.items.map((i) => i.id)));
  const names = await addOnNames(db, businessId, submissions.flatMap((sub) => sub.items.flatMap((i) => i.addOnIds)));
  const submissionsWithNames = submissions.map((sub) => ({
    ...sub,
    items: sub.items.map((i) => ({ ...i, addOnNames: i.addOnIds.map((id) => names.get(id) ?? "").filter(Boolean) })),
  }));
  return { menu, bestSellerIds, dishRatings, submissions: submissionsWithNames, requests, orderItems, estimate, bills, loyalty };
}

/** Most number changes one sitting may make: stops someone cycling through other people's numbers. */
const MAX_NUMBER_CHANGES = 3;

/**
 * The guest says whose points this visit should earn. Always answers the same way whether or
 * not the number is already a customer, so it cannot be used to find out who the customers are.
 */
export async function attachGuestCustomer(
  gc: GuestContext,
  input: { phone: string; name?: string; marketingConsent?: boolean },
): Promise<{ maskedPhone: string }> {
  const phone = normalizePhone(input.phone);
  const { businessId } = gc;
  return db.$transaction(async (tx) => {
    const session = await tx.tableSession.findFirst({
      where: { id: gc.sessionId, businessId, tableId: gc.tableId, closedAt: null },
    });
    if (!session) throw new DomainError("This table's session has ended. Scan the QR code again.");
    if (session.customerChanges >= MAX_NUMBER_CHANGES) {
      throw new DomainError("You have changed the number too many times. Please ask the staff.");
    }
    const customer = await upsertCustomer(tx, businessId, phone, {
      name: input.name,
      marketingConsent: input.marketingConsent,
      consentVerified: false, // typed on a phone: not verified
    });
    await tx.tableSession.update({
      where: { businessId_id: { businessId, id: session.id } },
      data: { customerId: customer.id, customerChanges: { increment: 1 } },
    });
    // Put it on the table's open order, but never over a customer the staff confirmed.
    await tx.order.updateMany({
      where: { businessId, tableId: gc.tableId, status: { in: ["OPEN", "SERVED"] }, customerConfirmed: false },
      data: { customerId: customer.id },
    });
    return { maskedPhone: maskPhone(phone) };
  });
}

/** What the guest's phone may say after their sitting ended. Never a balance. */
export type EndedSitting =
  | { reason: "PAID"; pointsEarned: number; hadCustomer: boolean }
  | { reason: "MOVED" | "MERGED" | "CANCELLED" };

export async function getSettledSummary(claims: { sessionId: string; tableId: string } | null): Promise<EndedSitting | null> {
  if (!claims) return null;
  const session = await db.tableSession.findFirst({
    where: { id: claims.sessionId, tableId: claims.tableId, closedAt: { not: null } },
  });
  if (!session) return null;
  if (session.closeReason === "MOVED" || session.closeReason === "MERGED" || session.closeReason === "CANCELLED") {
    return { reason: session.closeReason };
  }
  if (!session.closedByInvoiceId) return null;
  const invoice = await db.invoice.findFirst({
    where: { id: session.closedByInvoiceId, businessId: session.businessId },
    select: { pointsEarned: true, customerId: true },
  });
  if (!invoice) return null;
  return { reason: "PAID", pointsEarned: invoice.pointsEarned, hadCustomer: !!invoice.customerId };
}

// --- staff side ----------------------------------------------------------

function need(ctx: TenantContext) {
  if (!can(ctx.role, "order.edit")) throw new DomainError("You do not have permission to handle guest orders.");
}

export async function getInbox(ctx: TenantContext) {
  need(ctx);
  const [submissions, requests] = await Promise.all([
    db.guestSubmission.findMany({
      where: { businessId: ctx.businessId, status: "PENDING", table: { branchId: ctx.branchId } },
      include: { items: true, table: true },
      orderBy: { createdAt: "asc" },
    }),
    db.serviceRequest.findMany({
      where: { businessId: ctx.businessId, status: "OPEN", table: { branchId: ctx.branchId } },
      include: { table: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const names = await addOnNames(db, ctx.businessId, submissions.flatMap((sub) => sub.items.flatMap((i) => i.addOnIds)));
  return {
    submissions: submissions.map((sub) => ({
      ...sub,
      items: sub.items.map((i) => ({ ...i, addOnNames: i.addOnIds.map((id) => names.get(id) ?? "").filter(Boolean) })),
    })),
    requests,
  };
}

export async function inboxCount(ctx: TenantContext): Promise<number> {
  if (!can(ctx.role, "order.edit")) return 0;
  const [a, b] = await Promise.all([
    db.guestSubmission.count({ where: { businessId: ctx.businessId, status: "PENDING", table: { branchId: ctx.branchId } } }),
    db.serviceRequest.count({ where: { businessId: ctx.businessId, status: "OPEN", table: { branchId: ctx.branchId } } }),
  ]);
  return a + b;
}

/**
 * Move a guest's order onto the table's open order (or start one). Shared by staff
 * acceptance and by automatic acceptance when approval is switched off.
 */
async function acceptInTx(
  tx: Tx,
  businessId: string,
  submissionId: string,
  staffId: string | null,
  /** For staff: only a submission from a table in their branch can be accepted. */
  branchId?: string,
) {
  // Claim it first: if two staff tap Accept at once, only one gets through.
  const claimed = await tx.guestSubmission.updateMany({
    where: { id: submissionId, businessId, status: "PENDING", ...(branchId ? { table: { branchId } } : {}) },
    data: { status: "ACCEPTED", decidedAt: new Date(), decidedById: staffId },
  });
  if (claimed.count === 0) throw new DomainError("Someone else already handled this order.");

  const sub = await tx.guestSubmission.findFirstOrThrow({
    where: { id: submissionId, businessId },
    include: { items: true, table: true },
  });

  const ids = sub.items.map((i) => i.menuItemId);
  const menu = await tx.menuItem.findMany({ where: { businessId, id: { in: ids }, available: true }, select: { id: true, price: true } });
  const orderable = await orderableItemIds(tx, businessId, sub.table.branchId);
  const overrides = await branchMenuOverrides(tx, businessId, sub.table.branchId);
  const hiddenDishes = await hiddenDishIds(tx, businessId, sub.table.branchId);
  const ok = new Set(menu.filter((m) => (!orderable || orderable.has(m.id)) && (overrides.get(m.id)?.available ?? true) && !hiddenDishes.has(m.id)).map((m) => m.id));
  const gone = sub.items.filter((i) => !ok.has(i.menuItemId)).map((i) => i.name);
  if (gone.length > 0) {
    throw new DomainError(`No longer available: ${[...new Set(gone)].join(", ")}. Reject this order and tell the guest.`);
  }

  let order = await tx.order.findFirst({
    where: { businessId, tableId: sub.tableId, status: { in: ["OPEN", "SERVED"] } },
    orderBy: { createdAt: "asc" },
  });
  if (!order) {
    const { orderCounter } = await tx.business.update({
      where: { id: businessId },
      data: { orderCounter: { increment: 1 } },
      select: { orderCounter: true },
    });
    order = await tx.order.create({
      data: { businessId, branchId: sub.table.branchId, number: orderCounter, type: "DINE_IN", tableId: sub.tableId, createdById: staffId },
    });
    await tx.diningTable.update({
      where: { businessId_id: { businessId, id: sub.tableId } },
      data: { state: "SEATED" },
    });
  }

  // The guest's number follows the order, unless staff already attached someone.
  if (!order.customerId) {
    const sitting = await tx.tableSession.findFirst({ where: { id: sub.sessionId, businessId }, select: { customerId: true } });
    if (sitting?.customerId) {
      await tx.order.update({
        where: { businessId_id: { businessId, id: order.id } },
        data: { customerId: sitting.customerId, customerConfirmed: false },
      });
    }
  }

  // The choices are checked and priced again now: a size may have been switched off since the guest ordered.
  const basePrice = new Map(menu.map((m) => [m.id, effectiveItem({ price: m.price, available: true }, overrides.get(m.id)).price]));
  for (const i of sub.items) {
    let priced;
    try {
      priced = await priceAddOns(tx, businessId, i.menuItemId, i.addOnIds, sub.table.branchId);
    } catch (e) {
      if (e instanceof DomainError) throw new DomainError(`${i.name}: its options have changed. Reject this order and tell the guest.`);
      throw e;
    }
    await tx.orderItem.create({
      data: {
        businessId,
        orderId: order.id,
        menuItemId: i.menuItemId,
        name: i.name,
        unitPrice: (basePrice.get(i.menuItemId) ?? i.unitPrice) + priced.extra,
        quantity: i.quantity,
        note: i.note,
        addOns: { create: priced.chosen.map((c) => ({ businessId, addOnId: c.id, name: c.name, price: c.price })) },
      },
    });
  }
  await tx.guestSubmission.update({ where: { businessId_id: { businessId, id: submissionId } }, data: { orderId: order.id } });
  await syncOrderStatus(tx, businessId, order.id);
}

export async function acceptSubmission(ctx: TenantContext, submissionId: string) {
  need(ctx);
  await db.$transaction(async (tx) => {
    await acceptInTx(tx, ctx.businessId, submissionId, ctx.userId, ctx.branchId);
    await audit(tx, ctx, "guest.accept", "GuestSubmission", submissionId);
  });
  await queueSlipForSubmission(ctx.businessId, submissionId, ctx.userId);
}

/** After a guest's order becomes a real order, queue its kitchen slip if this business prints them by itself. */
async function queueSlipForSubmission(businessId: string, submissionId: string, userId: string | null) {
  try {
    const sub = await db.guestSubmission.findFirst({ where: { id: submissionId, businessId }, select: { orderId: true } });
    if (!sub?.orderId) return;
    const order = await db.order.findFirst({ where: { id: sub.orderId, businessId }, select: { branchId: true } });
    if (order) await autoQueueKitchenSlip(businessId, order.branchId, sub.orderId, userId);
  } catch {
    /* printing must never stop an order */
  }
}

export async function rejectSubmission(ctx: TenantContext, submissionId: string, reason?: string) {
  need(ctx);
  const clean = (reason ?? "").trim().slice(0, 200) || "Sorry, we cannot prepare this right now.";
  await db.$transaction(async (tx) => {
    const res = await tx.guestSubmission.updateMany({
      where: { id: submissionId, businessId: ctx.businessId, status: "PENDING", table: { branchId: ctx.branchId } },
      data: { status: "REJECTED", rejectReason: clean, decidedAt: new Date(), decidedById: ctx.userId },
    });
    if (res.count === 0) throw new DomainError("Someone else already handled this order.");
    await audit(tx, ctx, "guest.reject", "GuestSubmission", submissionId, { reason: clean });
  });
}

export async function completeRequest(ctx: TenantContext, requestId: string) {
  need(ctx);
  const res = await db.serviceRequest.updateMany({
    where: { id: requestId, businessId: ctx.businessId, status: "OPEN", table: { branchId: ctx.branchId } },
    data: { status: "DONE", doneAt: new Date(), doneById: ctx.userId },
  });
  if (res.count === 0) throw new DomainError("That request was already handled.");
}

/** Called inside the checkout transaction: the bill is paid, so the sitting ends. */
export type SittingEnd = { reason: "PAID"; invoiceId: string } | { reason: "MOVED" | "MERGED" | "QR_RESET" | "CANCELLED" };

export async function closeTableSittingsInTx(tx: Tx, businessId: string, tableId: string, end: SittingEnd) {
  const now = new Date();
  await tx.tableSession.updateMany({
    where: { businessId, tableId, closedAt: null },
    data: {
      closedAt: now,
      closeReason: end.reason,
      ...(end.reason === "PAID" ? { closedByInvoiceId: end.invoiceId } : {}),
    },
  });
  await tx.serviceRequest.updateMany({
    where: { businessId, tableId, status: "OPEN" },
    data: { status: "DONE", doneAt: now },
  });
  await tx.guestSubmission.updateMany({
    where: { businessId, tableId, status: "PENDING" },
    data: { status: "REJECTED", rejectReason:
        end.reason === "PAID"
          ? "This table was settled before the order was accepted."
          : end.reason === "CANCELLED"
            ? "This order was cancelled."
            : "This table changed before the order was accepted. Please scan the QR code on your table.", decidedAt: now },
  });
}
