import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { db } from "@/server/db";
import { Prisma } from "@/generated/prisma/client";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { scope } from "@/server/branch";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { detectImageType } from "@/features/menu/image";
import { previewBill } from "@/features/orders/server/service";
import type { DiscountInput } from "@/features/billing/calc";
import {
  cleanDisplayName,
  cleanOptions,
  cleanSetting,
  decideScreen,
  DEFAULT_THANKS,
  DEFAULT_WELCOME_TEXT,
  DEFAULT_WELCOME_TITLE,
  MAX_QR_BYTES,
  NO_OPTIONS,
  providerLabel,
  type BillOptions,
  type SettingInput,
} from "../display";

/**
 * The customer-facing screen. Staff side: the owner (or a manager) sets it up and makes screens; the till points a screen at the order
 * being rung up. Screen side: a secret link with no login returns what to show, and nothing else about the business.
 */

const token = () => `cd_${randomBytes(24).toString("base64url")}`;

function needManage(ctx: TenantContext) {
  if (!can(ctx, "display.manage")) throw new DomainError("You do not have permission to change the customer display.");
}

// --- setup ------------------------------------------------------------------------------

export async function getSetting(businessId: string) {
  const s = await db.displaySetting.findUnique({ where: { businessId }, select: { enabled: true, welcomeTitle: true, welcomeText: true, thanksText: true, thanksSeconds: true, showNotes: true, showLogo: true, autoQr: true, qrLabel: true, qrBytes: true, updatedAt: true } });
  return {
    enabled: s?.enabled ?? false,
    welcomeTitle: s?.welcomeTitle ?? null,
    welcomeText: s?.welcomeText ?? null,
    thanksText: s?.thanksText ?? null,
    thanksSeconds: s?.thanksSeconds ?? 12,
    showNotes: s?.showNotes ?? true,
    showLogo: s?.showLogo ?? true,
    autoQr: s?.autoQr ?? false,
    qrLabel: s?.qrLabel ?? null,
    hasQr: !!s?.qrBytes,
    qrVersion: s?.updatedAt.getTime() ?? 0,
  };
}

export async function saveSetting(ctx: TenantContext, input: SettingInput) {
  needManage(ctx);
  const data = cleanSetting(input);
  await db.$transaction(async (tx) => {
    await tx.displaySetting.upsert({ where: { businessId: ctx.businessId }, create: { businessId: ctx.businessId, ...data }, update: data });
    await audit(tx, ctx, "display.settings", "Business", ctx.businessId, { enabled: data.enabled });
  });
}

export async function setPaymentQr(ctx: TenantContext, bytes: Uint8Array) {
  needManage(ctx);
  if (bytes.length === 0) throw new DomainError("Choose a picture first.");
  if (bytes.length > MAX_QR_BYTES) throw new DomainError("That picture is too big. Choose one under 300 KB.");
  const type = detectImageType(bytes);
  if (!type) throw new DomainError("Use a JPEG, PNG or WebP picture.");
  const data = Buffer.from(bytes);
  await db.$transaction(async (tx) => {
    await tx.displaySetting.upsert({
      where: { businessId: ctx.businessId },
      create: { businessId: ctx.businessId, qrContentType: type, qrBytes: bytes.length, qrData: data },
      update: { qrContentType: type, qrBytes: bytes.length, qrData: data },
    });
    await audit(tx, ctx, "display.qr", "Business", ctx.businessId, { bytes: bytes.length });
  });
}

export async function removePaymentQr(ctx: TenantContext) {
  needManage(ctx);
  await db.$transaction(async (tx) => {
    await tx.displaySetting.updateMany({ where: { businessId: ctx.businessId }, data: { qrContentType: null, qrBytes: null, qrData: null, autoQr: false } });
    await tx.customerDisplay.updateMany({ where: { businessId: ctx.businessId }, data: { showQr: false } });
    await audit(tx, ctx, "display.qrRemove", "Business", ctx.businessId);
  });
}

export async function listDisplays(ctx: TenantContext) {
  const { businessId, branchId } = scope(ctx);
  if (!can(ctx, "display.manage") && !can(ctx, "bill.checkout")) throw new DomainError("You do not have permission to see customer displays.");
  const rows = await db.customerDisplay.findMany({ where: { businessId, branchId }, orderBy: { name: "asc" } });
  // The till opens the screen (second monitor, or full screen on this device), so cashiers get the link too; it shows only the order being rung up.
  return rows.map((d) => ({ id: d.id, name: d.name, token: d.token, orderId: d.orderId, showQr: d.showQr, followedAt: d.followedAt }));
}

export async function addDisplay(ctx: TenantContext, name: string) {
  needManage(ctx);
  const { businessId, branchId } = scope(ctx);
  const n = cleanDisplayName(name);
  if ((await db.customerDisplay.count({ where: { businessId, branchId } })) >= 10) throw new DomainError("A branch can have up to 10 customer screens.");
  if (await db.customerDisplay.findFirst({ where: { branchId, name: { equals: n, mode: "insensitive" } }, select: { id: true } })) throw new DomainError("This branch already has a screen with that name.");
  return db.$transaction(async (tx) => {
    const d = await tx.customerDisplay.create({ data: { businessId, branchId, name: n, token: token() } });
    await audit(tx, ctx, "display.add", "CustomerDisplay", d.id, { name: n });
    return d.id;
  });
}

export async function renameDisplay(ctx: TenantContext, id: string, name: string) {
  needManage(ctx);
  const { businessId, branchId } = scope(ctx);
  const n = cleanDisplayName(name);
  if (!(await db.customerDisplay.findFirst({ where: { id, businessId, branchId }, select: { id: true } }))) throw new DomainError("Screen not found.");
  if (await db.customerDisplay.findFirst({ where: { branchId, id: { not: id }, name: { equals: n, mode: "insensitive" } }, select: { id: true } })) throw new DomainError("This branch already has a screen with that name.");
  await db.customerDisplay.update({ where: { id }, data: { name: n } });
}

/** A new secret link. The old one stops working at once, so a screen that should no longer show bills is cut off. */
export async function newLink(ctx: TenantContext, id: string) {
  needManage(ctx);
  const { businessId, branchId } = scope(ctx);
  if (!(await db.customerDisplay.findFirst({ where: { id, businessId, branchId }, select: { id: true } }))) throw new DomainError("Screen not found.");
  await db.$transaction(async (tx) => {
    await tx.customerDisplay.update({ where: { id }, data: { token: token(), orderId: null, options: Prisma.DbNull, showQr: false, followedAt: null } });
    await audit(tx, ctx, "display.newLink", "CustomerDisplay", id);
  });
}

export async function deleteDisplay(ctx: TenantContext, id: string) {
  needManage(ctx);
  const { businessId, branchId } = scope(ctx);
  const d = await db.customerDisplay.findFirst({ where: { id, businessId, branchId }, select: { name: true } });
  if (!d) throw new DomainError("Screen not found.");
  await db.$transaction(async (tx) => {
    await tx.customerDisplay.delete({ where: { id } });
    await audit(tx, ctx, "display.delete", "CustomerDisplay", id, { name: d.name });
  });
}

// --- the till points a screen at an order -------------------------------------------------------

/**
 * The till says which order a screen should show, with the bill options chosen so far, or null to go back to the welcome. Called every
 * few seconds while the order is open. Only people who can take payment, only for this branch's screens and orders.
 */
export async function follow(ctx: TenantContext, input: { displayId: string; orderId: string | null; options?: unknown; showQr?: boolean }) {
  if (!can(ctx, "bill.checkout")) throw new DomainError("You do not have permission to use the customer display.");
  const { businessId, branchId } = scope(ctx);
  const d = await db.customerDisplay.findFirst({ where: { id: input.displayId, businessId, branchId }, select: { id: true } });
  if (!d) throw new DomainError("Screen not found.");
  if (!input.orderId) {
    // Leaving the till page right after a bill is paid must not cut the thank-you short: a paid bill stays pointed at until its thank-you ends.
    const cur = await db.customerDisplay.findUnique({ where: { id: d.id }, select: { orderId: true } });
    const paid = cur?.orderId ? await db.invoice.findFirst({ where: { businessId, orderId: cur.orderId }, select: { id: true } }) : null;
    await db.customerDisplay.update({ where: { id: d.id }, data: paid ? { showQr: false, followedAt: null } : { orderId: null, options: Prisma.DbNull, showQr: false, followedAt: null } });
    return;
  }
  const order = await db.order.findFirst({ where: { id: input.orderId, businessId, branchId }, select: { id: true, status: true, invoice: { select: { id: true } } } });
  if (!order) throw new DomainError("Order not found.");
  const options = cleanOptions(input.options);
  await db.customerDisplay.update({ where: { id: d.id }, data: { orderId: order.id, options: options as unknown as Prisma.InputJsonValue, showQr: !!input.showQr, followedAt: new Date() } });
}

// --- the screen's side ---------------------------------------------------------------------------

export interface ScreenLine {
  qty: number;
  name: string;
  extras: string[];
  note: string | null;
  total: number;
  free: boolean;
}
export interface ScreenTotals {
  subtotal: number;
  discount: number;
  loyaltyDiscount: number;
  serviceCharge: number;
  vat: number;
  deliveryFee: number;
  roundOff: number;
  grandTotal: number;
  dealName: string | null;
}
export interface ScreenState {
  kind: "OFF" | "IDLE" | "BILL" | "PAY" | "PAID" | "THANKS";
  business: string;
  logo: string | null;
  title: string;
  text: string;
  lines: ScreenLine[];
  totals: ScreenTotals | null;
  /** "Table 4", "Takeaway"... */
  where: string | null;
  qr: null | { kind: "static" | "intent"; label: string; svg?: string; src?: string };
  /** The amount the customer is asked to pay, for the QR panel. */
  payAmount: number | null;
  paidAmount: number | null;
  /** Changes whenever what is shown changes, so the screen can skip redrawing. */
  version: string;
}

const TYPE: Record<string, string> = { TAKEAWAY: "Takeaway", DELIVERY: "Delivery", QUICK_BILL: "Counter sale" };

/** What a screen shows right now, found by its secret link. Null when the link is not (or no longer) valid. */
export async function screenState(tok: string, baseUrl: string, now = new Date()): Promise<ScreenState | null> {
  if (!/^cd_[A-Za-z0-9_-]{20,60}$/.test(tok)) return null;
  const d = await db.customerDisplay.findUnique({ where: { token: tok } });
  if (!d) return null;
  const [setting, business, logo] = await Promise.all([
    db.displaySetting.findUnique({ where: { businessId: d.businessId }, select: { enabled: true, welcomeTitle: true, welcomeText: true, thanksText: true, thanksSeconds: true, showNotes: true, showLogo: true, autoQr: true, qrLabel: true, qrBytes: true, updatedAt: true } }),
    db.business.findUniqueOrThrow({ where: { id: d.businessId }, select: { name: true } }),
    db.businessLogo.findUnique({ where: { businessId: d.businessId }, select: { updatedAt: true } }),
  ]);
  const base: ScreenState = {
    kind: "IDLE",
    business: business.name,
    logo: setting?.showLogo !== false && logo ? `/api/display/${tok}/logo?v=${logo.updatedAt.getTime()}` : null,
    title: setting?.welcomeTitle ?? DEFAULT_WELCOME_TITLE,
    text: setting?.welcomeText ?? DEFAULT_WELCOME_TEXT,
    lines: [],
    totals: null,
    where: null,
    qr: null,
    payAmount: null,
    paidAmount: null,
    version: "",
  };
  const order = d.orderId
    ? await db.order.findFirst({
        where: { id: d.orderId, businessId: d.businessId, branchId: d.branchId },
        include: { table: { select: { label: true } }, invoice: { select: { grandTotal: true, createdAt: true } }, items: { orderBy: { createdAt: "asc" }, include: { addOns: { select: { name: true } } } } },
      })
    : null;
  const live = order ? order.items.filter((i) => i.status !== "CANCELLED") : [];
  const intent = order
    ? await db.paymentIntent.findFirst({ where: { businessId: d.businessId, orderId: order.id, consumedAt: null, status: { in: ["CREATED", "PENDING", "PAID"] }, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } })
    : null;
  const screen = decideScreen({
    enabled: setting?.enabled ?? false,
    now,
    orderId: d.orderId,
    followedAt: d.followedAt,
    order: order ? { status: order.status, invoiceAt: order.invoice?.createdAt ?? null, hasLines: live.length > 0 } : null,
    intent: intent ? { status: intent.status } : null,
    hasStaticQr: !!setting?.qrBytes,
    showQr: d.showQr,
    autoQr: setting?.autoQr ?? false,
    thanksSeconds: setting?.thanksSeconds ?? 12,
  });
  const out: ScreenState = { ...base, kind: screen.kind };
  if (screen.kind === "OFF") return { ...out, title: "", text: "", version: "off" };
  if (screen.kind === "IDLE") return { ...out, version: `idle:${out.title}:${out.text}:${out.logo ?? ""}` };
  if (screen.kind === "THANKS") {
    return { ...out, title: setting?.thanksText ?? DEFAULT_THANKS, paidAmount: order?.invoice?.grandTotal ?? null, version: `thanks:${order?.invoice?.createdAt.getTime()}` };
  }
  if (!order) return { ...out, kind: "IDLE", version: "idle" };

  // The bill as it is being built: the same maths the till uses, with the options the cashier has chosen.
  const opts: BillOptions = cleanOptions(d.options ?? NO_OPTIONS);
  const system: import("@/server/auth").TenantContext = { userId: "customer-display", businessId: d.businessId, branchId: d.branchId, branchIds: [d.branchId], role: "OWNER" };
  const discount: DiscountInput = opts.discountPercent > 0 ? { kind: "percent", bps: Math.round(opts.discountPercent * 100) } : { kind: "none" };
  let t: Awaited<ReturnType<typeof previewBill>> | null = null;
  try {
    t = await previewBill(system, order.id, discount, opts.redeemPoints, opts.rewardValueMinor > 0 ? { valueMinor: opts.rewardValueMinor } : null, opts.stampProgramId ? { programId: opts.stampProgramId, orderItemId: opts.stampItemId ?? undefined } : null);
  } catch {
    try {
      t = await previewBill(system, order.id, discount);
    } catch {
      t = null;
    }
  }
  const showNotes = setting?.showNotes !== false;
  const lines: ScreenLine[] = live.map((i) => ({ qty: i.quantity, name: i.name, extras: i.addOns.map((a) => a.name), note: showNotes ? i.note : null, total: i.complimentary ? 0 : i.unitPrice * i.quantity, free: i.complimentary }));
  const totals: ScreenTotals | null = t
    ? { subtotal: t.subtotal, discount: t.discount, loyaltyDiscount: t.loyaltyDiscount, serviceCharge: t.serviceCharge, vat: t.vat, deliveryFee: t.deliveryFee, roundOff: t.roundOff, grandTotal: t.grandTotal, dealName: t.deal?.name ?? null }
    : null;
  const result: ScreenState = { ...out, lines, totals, where: order.table ? `Table ${order.table.label}` : (TYPE[order.type] ?? null), payAmount: totals?.grandTotal ?? null };

  if (screen.qr === "intent" && intent) {
    const svg = await QRCode.toString(`${baseUrl.replace(/\/+$/, "")}/pay/${intent.token}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    result.qr = { kind: "intent", label: providerLabel(intent.provider), svg };
    result.payAmount = intent.amount;
  } else if (screen.qr === "static") {
    result.qr = { kind: "static", label: setting?.qrLabel ?? "Scan to pay", src: `/api/display/${tok}/qr?v=${setting?.updatedAt.getTime() ?? 0}` };
  }
  if (screen.kind === "PAID") result.paidAmount = intent?.amount ?? null;
  result.version = JSON.stringify([result.kind, lines, totals, result.qr?.kind, result.qr?.label, intent?.id, intent?.status, result.where]);
  return result;
}

/** The fixed payment QR picture, for a screen with a valid link. */
export async function screenQr(tok: string) {
  if (!/^cd_[A-Za-z0-9_-]{20,60}$/.test(tok)) return null;
  const d = await db.customerDisplay.findUnique({ where: { token: tok }, select: { businessId: true } });
  if (!d) return null;
  const s = await db.displaySetting.findUnique({ where: { businessId: d.businessId }, select: { qrContentType: true, qrData: true } });
  return s?.qrData && s.qrContentType ? { contentType: s.qrContentType, data: s.qrData } : null;
}

/** The business logo, for a screen with a valid link. */
export async function screenLogo(tok: string) {
  if (!/^cd_[A-Za-z0-9_-]{20,60}$/.test(tok)) return null;
  const d = await db.customerDisplay.findUnique({ where: { token: tok }, select: { businessId: true } });
  if (!d) return null;
  const l = await db.businessLogo.findUnique({ where: { businessId: d.businessId }, select: { contentType: true, data: true } });
  return l ?? null;
}

/** The fixed payment QR picture, for the owner's own preview on the setup page. */
export async function previewPaymentQr(ctx: TenantContext) {
  needManage(ctx);
  const s = await db.displaySetting.findUnique({ where: { businessId: ctx.businessId }, select: { qrContentType: true, qrData: true } });
  return s?.qrData && s.qrContentType ? { contentType: s.qrContentType, data: s.qrData } : null;
}
