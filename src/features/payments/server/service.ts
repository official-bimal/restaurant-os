import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { seal, unseal } from "@/lib/secretbox";
import { randomKey } from "@/lib/random-key";
import { checkout, previewBill } from "@/features/orders/server/service";
import { pushToTeam } from "@/features/notifications/server/push";
import { publishLive } from "@/server/live";
import { formatNpr } from "@/features/billing/calc";
import {
  ESEWA_TEST,
  esewaConfirm,
  esewaForm,
  khaltiInitiate,
  khaltiLookup,
  PROVIDERS,
  providerLabel,
  readEsewaReply,
  type Confirmation,
  type EsewaForm,
  type FetchLike,
  type Mode,
} from "../gateways";

/**
 * Taking payment through eSewa and Khalti, and recording payments made through other services by hand.
 *
 * eSewa and Khalti: the cashier starts a payment for the bill, the customer pays on their phone, the software asks the service whether it was
 * really paid, and only then can the bill be completed (for exactly the amount asked for, once). Other services (Fonepay QR, ConnectIPS,
 * IME Pay, cards) are recorded on the bill with the reference the customer or the machine shows; the software cannot check those.
 * Every query is filtered by businessId.
 */

const realFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;
const INTENT_MINUTES = 30;

function needBill(ctx: TenantContext) {
  if (!can(ctx, "bill.checkout")) throw new DomainError("You do not have permission to take payments.");
}
function needSetup(ctx: TenantContext) {
  if (!can(ctx, "owner.control") && !can(ctx, "branch.manage")) throw new DomainError("Only the owner can set up payment services.");
}

// ---------------------------------------------------------------------------------------------------
// set-up

export interface SettingView {
  provider: string;
  label: string;
  kind: "API" | "MANUAL";
  enabled: boolean;
  mode: Mode;
  merchantCode: string;
  hasSecret: boolean;
  hint: string;
}

/** Each service with whether it is on. Manual services are on until switched off; eSewa and Khalti are off until the owner switches them on. */
export async function getPaymentSettings(ctx: TenantContext): Promise<SettingView[]> {
  needSetup(ctx);
  const rows = await db.paymentSetting.findMany({ where: { businessId: ctx.businessId } });
  return PROVIDERS.map((p) => {
    const r = rows.find((x) => x.provider === p.id);
    return {
      provider: p.id,
      label: p.label,
      kind: p.kind,
      enabled: r ? r.enabled : p.kind === "MANUAL",
      mode: (r?.mode === "LIVE" ? "LIVE" : "TEST") as Mode,
      merchantCode: r?.merchantCode ?? "",
      hasSecret: !!r?.secretSealed,
      hint: p.hint,
    };
  });
}

export async function savePaymentSetting(ctx: TenantContext, provider: string, input: { enabled: boolean; mode: string; merchantCode?: string; secret?: string }) {
  needSetup(ctx);
  const info = PROVIDERS.find((p) => p.id === provider);
  if (!info) throw new DomainError("Unknown payment service.");
  if (input.mode !== "TEST" && input.mode !== "LIVE") throw new DomainError("Choose test or live.");
  const merchantCode = (input.merchantCode ?? "").trim().slice(0, 60) || null;
  const secret = (input.secret ?? "").trim();
  if (secret.length > 300) throw new DomainError("That key is too long.");
  if (input.enabled && info.kind === "API" && input.mode === "LIVE") {
    if (provider === "ESEWA" && (!merchantCode || !(secret || (await hasSecret(ctx.businessId, provider))))) throw new DomainError("Live eSewa needs your product code and secret key.");
    if (provider === "KHALTI" && !(secret || (await hasSecret(ctx.businessId, provider)))) throw new DomainError("Live Khalti needs your secret key.");
  }
  if (input.enabled && provider === "KHALTI" && !(secret || (await hasSecret(ctx.businessId, provider)))) throw new DomainError("Khalti needs a secret key from your Khalti merchant account (a test key from test-admin.khalti.com works for testing).");
  await db.$transaction(async (tx) => {
    const data = { enabled: input.enabled, mode: input.mode, merchantCode, ...(secret ? { secretSealed: seal(secret) } : {}) };
    await tx.paymentSetting.upsert({ where: { businessId_provider: { businessId: ctx.businessId, provider: info.id } }, create: { businessId: ctx.businessId, provider: info.id, ...data }, update: data });
    // The key itself is never written to the audit log.
    await audit(tx, ctx, "payments.setting", "PaymentSetting", info.id, { enabled: input.enabled, mode: input.mode, keyChanged: !!secret });
  });
}

async function hasSecret(businessId: string, provider: string): Promise<boolean> {
  const r = await db.paymentSetting.findFirst({ where: { businessId, provider: provider as never }, select: { secretSealed: true } });
  return !!r?.secretSealed;
}

interface Resolved {
  mode: Mode;
  merchantCode: string;
  secret: string;
}

/** What it takes to talk to a service for this business: its mode, merchant code and secret. Null when it is off or not set up. */
async function resolve(businessId: string, provider: "ESEWA" | "KHALTI"): Promise<Resolved | null> {
  const r = await db.paymentSetting.findFirst({ where: { businessId, provider } });
  if (!r || !r.enabled) return null;
  const mode: Mode = r.mode === "LIVE" ? "LIVE" : "TEST";
  const secret = r.secretSealed ? unseal(r.secretSealed) : null;
  if (provider === "ESEWA") {
    if (mode === "TEST") return { mode, merchantCode: r.merchantCode || ESEWA_TEST.productCode, secret: secret ?? ESEWA_TEST.secret };
    return secret && r.merchantCode ? { mode, merchantCode: r.merchantCode, secret } : null;
  }
  return secret ? { mode, merchantCode: "", secret } : null;
}

/** The services the cashier can use on a bill right now. */
export async function checkoutMethods(ctx: TenantContext) {
  needBill(ctx);
  const rows = await db.paymentSetting.findMany({ where: { businessId: ctx.businessId } });
  const out = [];
  for (const p of PROVIDERS) {
    const r = rows.find((x) => x.provider === p.id);
    if (p.kind === "MANUAL") {
      if (!r || r.enabled) out.push({ id: p.id, label: p.label, kind: p.kind, chip: p.chip, hint: p.hint, mode: "TEST" as Mode });
    } else if (await resolve(ctx.businessId, p.id as "ESEWA" | "KHALTI")) {
      out.push({ id: p.id, label: p.label, kind: p.kind, chip: p.chip, hint: p.hint, mode: (r?.mode === "LIVE" ? "LIVE" : "TEST") as Mode });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// starting a payment

export interface BillParams {
  discountPercent?: number;
  redeemPoints?: number;
  stampProgramId?: string;
  stampItemId?: string;
  buyerName?: string;
  buyerPan?: string;
}

function discountOf(p: BillParams) {
  const pct = Number(p.discountPercent ?? 0);
  return pct > 0 && pct <= 100 ? ({ kind: "percent", bps: Math.round(pct * 100) } as const) : ({ kind: "none" } as const);
}

/** Starts a payment through eSewa or Khalti for the bill as it stands. `baseUrl` is how the customer's phone reaches this server. */
export async function createIntent(
  ctx: TenantContext,
  orderId: string,
  provider: string,
  params: BillParams,
  baseUrl: string,
  deps: { fetch?: FetchLike } = {},
  meta: { byGuest?: boolean } = {},
) {
  needBill(ctx);
  const { businessId, branchId } = scope(ctx);
  if (provider !== "ESEWA" && provider !== "KHALTI") throw new DomainError("That service is recorded by hand, not started here.");
  const cfg = await resolve(businessId, provider);
  if (!cfg) throw new DomainError(`${providerLabel(provider)} is not switched on. The owner can set it up under Settings, Payments.`);
  const order = await db.order.findFirst({ where: { id: orderId, businessId, branchId }, select: { id: true, number: true, status: true, invoice: { select: { id: true } } } });
  if (!order) throw new DomainError("Order not found.");
  if (order.invoice || ["PAID", "CANCELLED", "MERGED"].includes(order.status)) throw new DomainError("This order is already closed.");
  const t = await previewBill(ctx, orderId, discountOf(params), params.redeemPoints ?? 0, null, params.stampProgramId ? { programId: params.stampProgramId, orderItemId: params.stampItemId } : null);
  if (t.grandTotal <= 0) throw new DomainError("There is nothing to pay.");

  // One live attempt per bill: starting again cancels the old one, so two phones cannot both pay.
  await db.paymentIntent.updateMany({ where: { businessId, orderId, status: { in: ["CREATED", "PENDING"] }, consumedAt: null }, data: { status: "CANCELLED", failReason: "Replaced by a new payment" } });

  const token = randomKey();
  const uuid = `${order.number}-${randomKey().slice(0, 8)}`.replace(/[^A-Za-z0-9-]/g, "");
  const base = baseUrl.replace(/\/+$/, "");
  let providerRef: string | null = null;
  let payUrl: string | null = null;
  if (provider === "KHALTI") {
    const r = await khaltiInitiate(deps.fetch ?? realFetch, { mode: cfg.mode, secret: cfg.secret, amount: t.grandTotal, orderId: uuid, orderName: `Bill for order ${order.number}`, returnUrl: `${base}/api/pay/khalti/return?token=${token}`, websiteUrl: base });
    if (!r.ok) throw new DomainError(r.error);
    providerRef = r.start.pidx;
    payUrl = r.start.payUrl;
  }
  return db.$transaction(async (tx) => {
    const intent = await tx.paymentIntent.create({
      data: {
        businessId,
        branchId,
        orderId,
        provider,
        amount: t.grandTotal,
        token,
        uuid,
        providerRef,
        payUrl,
        checkout: { ...params } as object,
        createdById: ctx.userId,
        byGuest: !!meta.byGuest,
        expiresAt: new Date(Date.now() + INTENT_MINUTES * 60_000),
      },
    });
    await audit(tx, ctx, "payments.start", "PaymentIntent", intent.id, { provider, amount: t.grandTotal, order: order.number });
    return intent;
  });
}

// ---------------------------------------------------------------------------------------------------
// the customer's page (no sign-in: the long token in the link is the credential)

export type PayPage =
  | { kind: "esewa"; form: EsewaForm; amount: number; business: string }
  | { kind: "khalti"; url: string; amount: number; business: string }
  | { kind: "done" | "expired" | "closed"; amount: number; business: string };

const validToken = (t: string) => /^[A-Za-z0-9_-]{16,40}$/.test(t);

export async function getPayPage(token: string, baseUrl: string): Promise<PayPage | null> {
  if (!validToken(token)) return null;
  const i = await db.paymentIntent.findUnique({ where: { token } });
  if (!i) return null;
  const biz = await db.business.findUniqueOrThrow({ where: { id: i.businessId }, select: { name: true } });
  const common = { amount: i.amount, business: biz.name };
  if (i.status === "PAID") return { kind: "done", ...common };
  if (i.status === "CANCELLED" || i.status === "FAILED") return { kind: "closed", ...common };
  if (i.expiresAt.getTime() < Date.now()) return { kind: "expired", ...common };
  const base = baseUrl.replace(/\/+$/, "");
  if (i.provider === "KHALTI" && i.payUrl) {
    await db.paymentIntent.updateMany({ where: { id: i.id, status: "CREATED" }, data: { status: "PENDING" } });
    return { kind: "khalti", url: i.payUrl, ...common };
  }
  if (i.provider === "ESEWA") {
    const cfg = await resolve(i.businessId, "ESEWA");
    if (!cfg) return { kind: "closed", ...common };
    await db.paymentIntent.updateMany({ where: { id: i.id, status: "CREATED" }, data: { status: "PENDING" } });
    return { kind: "esewa", form: esewaForm({ mode: cfg.mode, productCode: cfg.merchantCode, secret: cfg.secret, amount: i.amount, uuid: i.uuid, successUrl: `${base}/api/pay/esewa/return`, failureUrl: `${base}/api/pay/esewa/failed?token=${token}` }), ...common };
  }
  return { kind: "closed", ...common };
}

// ---------------------------------------------------------------------------------------------------
// checking what happened

async function settle(intentId: string, c: Confirmation) {
  if (c.paid) {
    // Only the first confirmation counts; later ones change nothing.
    await db.paymentIntent.updateMany({ where: { id: intentId, status: { in: ["CREATED", "PENDING", "EXPIRED"] } }, data: { status: "PAID", reference: c.reference, paidAt: new Date(), failReason: null } });
  } else if (c.state === "failed") {
    await db.paymentIntent.updateMany({ where: { id: intentId, status: { in: ["CREATED", "PENDING"] } }, data: { status: "FAILED", failReason: c.reason.slice(0, 160) } });
  } else {
    await db.paymentIntent.updateMany({ where: { id: intentId, status: { in: ["CREATED", "PENDING"] } }, data: { failReason: c.reason.slice(0, 160) } });
  }
}

/** The saved set-up of eSewa or Khalti for a business, or null when it is off or incomplete. */
export const resolveProvider = (businessId: string, provider: "ESEWA" | "KHALTI") => resolve(businessId, provider);

/** Asks the service whether an attempt was paid, and records the answer. Safe to run any number of times. */
async function check(intentId: string, deps: { fetch?: FetchLike } = {}): Promise<string> {
  const i = await db.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
  if (i.status === "PAID" || i.status === "CANCELLED") return i.status;
  const provider = i.provider as "ESEWA" | "KHALTI";
  const cfg = await resolve(i.businessId, provider);
  if (!cfg) return i.status;
  const f = deps.fetch ?? realFetch;
  const c = provider === "ESEWA" ? await esewaConfirm(f, { mode: cfg.mode, productCode: cfg.merchantCode, amount: i.amount, uuid: i.uuid }) : await khaltiLookup(f, { mode: cfg.mode, secret: cfg.secret, pidx: i.providerRef ?? "", amount: i.amount });
  await settle(i.id, c);
  const status = (await db.paymentIntent.findUniqueOrThrow({ where: { id: i.id }, select: { status: true } })).status;
  // A guest who paid from the table page has no cashier to press "complete": the bill closes itself, once, when the service confirms.
  if (status === "PAID" && i.byGuest) await completeGuestPayment(i.id);
  return status;
}

/** Ask the service about a guest's unfinished payment (their page is open but they may never come back from the service). */
export async function refreshByGuest(intentId: string, deps: { fetch?: FetchLike } = {}): Promise<string> {
  return check(intentId, deps);
}

/** eSewa sent the customer back with signed `data`: check the signature, then ask eSewa. Returns the token of the attempt, or null. */
export async function handleEsewaReturn(data: string, deps: { fetch?: FetchLike } = {}): Promise<{ token: string; status: string } | null> {
  // Read the unsigned reply first only to find which attempt it names; nothing in it is trusted until the signature checks.
  let uuid = "";
  try {
    uuid = String((JSON.parse(Buffer.from(data, "base64").toString("utf8")) as { transaction_uuid?: string }).transaction_uuid ?? "");
  } catch {
    return null;
  }
  const i = await db.paymentIntent.findUnique({ where: { uuid } });
  if (!i || i.provider !== "ESEWA") return null;
  const cfg = await resolve(i.businessId, "ESEWA");
  if (!cfg) return { token: i.token, status: i.status };
  const reply = readEsewaReply(data, cfg.secret);
  if (!reply || reply.transaction_uuid !== i.uuid) return { token: i.token, status: i.status };
  return { token: i.token, status: await check(i.id, deps) };
}

/** Khalti sent the customer back to our link: the query is not trusted, Khalti is asked. */
export async function handleKhaltiReturn(token: string, deps: { fetch?: FetchLike } = {}): Promise<{ token: string; status: string } | null> {
  if (!validToken(token)) return null;
  const i = await db.paymentIntent.findUnique({ where: { token } });
  if (!i || i.provider !== "KHALTI") return null;
  return { token, status: await check(i.id, deps) };
}

export async function getResult(token: string) {
  if (!validToken(token)) return null;
  const i = await db.paymentIntent.findUnique({ where: { token } });
  if (!i) return null;
  const biz = await db.business.findUniqueOrThrow({ where: { id: i.businessId }, select: { name: true } });
  // A guest who paid from the table page is offered the way back to it.
  let back: string | null = null;
  if (i.byGuest) {
    const o = await db.order.findFirst({ where: { id: i.orderId, businessId: i.businessId }, select: { table: { select: { publicToken: true } } } });
    if (o?.table) back = `/t/${o.table.publicToken}`;
  }
  return { status: i.status, amount: i.amount, business: biz.name, provider: providerLabel(i.provider), back };
}

/** The system's own identity when it closes a guest's bill: this business and branch only, with a cashier's rights, never a signed-in person. */
export function guestPayCtx(businessId: string, branchId: string): TenantContext {
  return { userId: "guest-pay", businessId, branchId, branchIds: [branchId], role: "CASHIER" };
}

/**
 * A guest's payment was confirmed: close the bill exactly as it was when they paid, and tell the floor. If the bill changed in between
 * (an item was added after the payment started), it is left paid and open and the staff are told to sort it out with the customer.
 */
export async function completeGuestPayment(intentId: string) {
  const i = await db.paymentIntent.findUnique({ where: { id: intentId } });
  if (!i || !i.byGuest || i.status !== "PAID" || i.consumedAt) return;
  const order = await db.order.findFirst({ where: { id: i.orderId, businessId: i.businessId }, select: { number: true, table: { select: { label: true } } } });
  const where = order?.table ? `Table ${order.table.label}` : `Order #${order?.number ?? ""}`;
  const tell = (title: string, body: string) =>
    void pushToTeam({ businessId: i.businessId, branchId: i.branchId, permission: "bill.checkout", payload: { title, body, tag: `guestpay-${i.id}`, url: `/orders/${i.orderId}` } }).catch(() => undefined);
  try {
    await completeFromIntent(guestPayCtx(i.businessId, i.branchId), i.id);
    publishLive({ businessId: i.businessId, branchId: i.branchId, topic: "guest" });
    tell(`${where} paid ${formatNpr(i.amount)} with ${providerLabel(i.provider)}`, "The bill is closed.");
  } catch (e) {
    // Two confirmations arriving together: the second finds the bill already being closed by the first, which is fine.
    if (e instanceof DomainError && /already been used/.test(e.message)) return;
    const why = e instanceof DomainError ? e.message : "It could not be closed.";
    publishLive({ businessId: i.businessId, branchId: i.branchId, topic: "guest" });
    tell(`${where} paid ${formatNpr(i.amount)} with ${providerLabel(i.provider)}, but the bill is still open`, why.slice(0, 140));
  }
}

// ---------------------------------------------------------------------------------------------------
// the cashier's side

export async function listBillIntents(ctx: TenantContext, orderId: string) {
  needBill(ctx);
  const { businessId, branchId } = scope(ctx);
  const rows = await db.paymentIntent.findMany({ where: { businessId, branchId, orderId, consumedAt: null, status: { in: ["CREATED", "PENDING", "PAID", "FAILED"] } }, orderBy: { createdAt: "desc" }, take: 3 });
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    label: providerLabel(r.provider),
    amount: r.amount,
    status: r.status === "PENDING" || r.status === "CREATED" ? (r.expiresAt.getTime() < Date.now() ? "EXPIRED" : r.status) : r.status,
    token: r.token,
    reference: r.reference,
    failReason: r.failReason,
    expiresAt: r.expiresAt,
  }));
}

/** The cashier presses "Check now": ask the service again. */
export async function refreshIntent(ctx: TenantContext, intentId: string, deps: { fetch?: FetchLike } = {}) {
  needBill(ctx);
  const { businessId } = scope(ctx);
  const i = await db.paymentIntent.findFirst({ where: { id: intentId, businessId } });
  if (!i) throw new DomainError("Payment not found.");
  return check(i.id, deps);
}

export async function cancelIntent(ctx: TenantContext, intentId: string) {
  needBill(ctx);
  const { businessId } = scope(ctx);
  await db.$transaction(async (tx) => {
    const r = await tx.paymentIntent.updateMany({ where: { id: intentId, businessId, status: { in: ["CREATED", "PENDING", "FAILED"] }, consumedAt: null }, data: { status: "CANCELLED", failReason: "Cancelled by staff" } });
    if (r.count === 0) throw new DomainError("That payment can no longer be cancelled.");
    await audit(tx, ctx, "payments.cancel", "PaymentIntent", intentId);
  });
}

/**
 * Completes the bill from a confirmed payment, exactly as shown when the payment was started. The bill must still come to the amount that was
 * paid, and a payment can be used once.
 */
export async function completeFromIntent(ctx: TenantContext, intentId: string) {
  needBill(ctx);
  const { businessId, branchId } = scope(ctx);
  const i = await db.paymentIntent.findFirst({ where: { id: intentId, businessId, branchId } });
  if (!i) throw new DomainError("Payment not found.");
  if (i.status !== "PAID") throw new DomainError("That payment has not been confirmed yet.");
  // Claim it first, so a double tap or two cashiers make one bill.
  const claim = await db.paymentIntent.updateMany({ where: { id: i.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (claim.count === 0) throw new DomainError("This payment has already been used for a bill.");
  try {
    const p = (i.checkout ?? {}) as BillParams;
    const t = await previewBill(ctx, i.orderId, discountOf(p), p.redeemPoints ?? 0, null, p.stampProgramId ? { programId: p.stampProgramId, orderItemId: p.stampItemId } : null);
    if (t.grandTotal !== i.amount) throw new DomainError("The bill has changed since the payment was started. Refund the customer through the service, then start the payment again.");
    return await checkout(ctx, i.orderId, {
      discount: discountOf(p),
      redeemPoints: p.redeemPoints ?? 0,
      stampProgramId: p.stampProgramId,
      stampItemId: p.stampItemId,
      buyerName: p.buyerName,
      buyerPan: p.buyerPan,
      payments: [{ method: "QR", amount: i.amount, provider: i.provider, reference: i.reference ?? undefined }],
    });
  } catch (e) {
    await db.paymentIntent.updateMany({ where: { id: i.id }, data: { consumedAt: null } });
    throw e;
  }
}
