import { createHash, randomBytes } from "node:crypto";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { clampInt, DEFAULT_LAYOUT, PAPER_LIMITS, type LayoutSettings } from "../layout";

/**
 * How this business's slips are laid out: paper size (any width, fixed or automatic height), margins, text size and what
 * appears on them. Everything is per business. Anyone who prints can read the settings; only people with print.manage
 * change them.
 */

export interface PrintConfig extends LayoutSettings {
  paperWidthMm: number;
  paperHeightMm: number | null;
  marginMm: number;
  fontSizeTenthPt: number;
  autoKitchenPrint: boolean;
  receiptCopies: number;
}

export const DEFAULT_CONFIG: PrintConfig = {
  ...DEFAULT_LAYOUT,
  paperWidthMm: 80,
  paperHeightMm: null,
  marginMm: 4,
  fontSizeTenthPt: 90,
  autoKitchenPrint: false,
  receiptCopies: 1,
};

type Row = Awaited<ReturnType<typeof db.printSetting.findUnique>>;

function fromRow(r: Row): PrintConfig {
  if (!r) return { ...DEFAULT_CONFIG };
  return {
    paperWidthMm: r.paperWidthMm,
    paperHeightMm: r.paperHeightMm,
    marginMm: r.marginMm,
    fontSizeTenthPt: r.fontSizeTenthPt,
    headerLine: r.headerLine,
    footerLine: r.footerLine,
    showPan: r.showPan,
    showAddress: r.showAddress,
    showCustomer: r.showCustomer,
    kitchenLargeText: r.kitchenLargeText,
    autoKitchenPrint: r.autoKitchenPrint,
    receiptCopies: r.receiptCopies,
  };
}

export async function getPrintConfig(businessId: string): Promise<PrintConfig> {
  return fromRow(await db.printSetting.findUnique({ where: { businessId } }));
}

export interface PrintConfigInput {
  paperWidthMm: number;
  /** Empty or 0 means "as long as the content needs". */
  paperHeightMm: number | null;
  marginMm: number;
  fontSizeTenthPt: number;
  headerLine: string;
  footerLine: string;
  showPan: boolean;
  showAddress: boolean;
  showCustomer: boolean;
  kitchenLargeText: boolean;
  autoKitchenPrint: boolean;
  receiptCopies: number;
}

const cleanLine = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);

export async function savePrintConfig(ctx: TenantContext, input: PrintConfigInput) {
  if (!can(ctx, "print.manage")) throw new DomainError("You do not have permission to change print settings.");
  for (const [name, v, lim] of [
    ["Paper width", input.paperWidthMm, PAPER_LIMITS.widthMm],
    ["Margin", input.marginMm, PAPER_LIMITS.marginMm],
  ] as const) {
    if (!Number.isFinite(v) || v < lim[0] || v > lim[1]) throw new DomainError(`${name} must be between ${lim[0]} and ${lim[1]} mm.`);
  }
  if (input.paperHeightMm && (input.paperHeightMm < PAPER_LIMITS.heightMm[0] || input.paperHeightMm > PAPER_LIMITS.heightMm[1])) {
    throw new DomainError(`Paper height must be between ${PAPER_LIMITS.heightMm[0]} and ${PAPER_LIMITS.heightMm[1]} mm, or empty for automatic.`);
  }
  if (input.fontSizeTenthPt < PAPER_LIMITS.fontTenthPt[0] || input.fontSizeTenthPt > PAPER_LIMITS.fontTenthPt[1]) throw new DomainError("Text size must be between 6 and 16 pt.");
  if (!Number.isInteger(input.receiptCopies) || input.receiptCopies < 1 || input.receiptCopies > 5) throw new DomainError("Receipt copies must be 1 to 5.");
  if (input.marginMm * 2 >= input.paperWidthMm - 10) throw new DomainError("The margins leave no room for text on that paper.");
  const data = {
    paperWidthMm: Math.round(input.paperWidthMm),
    paperHeightMm: input.paperHeightMm ? Math.round(input.paperHeightMm) : null,
    marginMm: Math.round(input.marginMm),
    fontSizeTenthPt: Math.round(input.fontSizeTenthPt),
    headerLine: cleanLine(input.headerLine, 80) || null,
    footerLine: cleanLine(input.footerLine, 120),
    showPan: input.showPan,
    showAddress: input.showAddress,
    showCustomer: input.showCustomer,
    kitchenLargeText: input.kitchenLargeText,
    autoKitchenPrint: input.autoKitchenPrint,
    receiptCopies: input.receiptCopies,
  };
  await db.$transaction(async (tx) => {
    await tx.printSetting.upsert({ where: { businessId: ctx.businessId }, create: { businessId: ctx.businessId, ...data }, update: data });
    await audit(tx, ctx, "print.settings", "Business", ctx.businessId, { paper: `${data.paperWidthMm}x${data.paperHeightMm ?? "auto"}`, auto: data.autoKitchenPrint });
  });
}

/** Paper for one print: the saved setting, optionally overridden by a size picked at the time (clamped to sane limits). */
export function paperFor(cfg: PrintConfig, overrides: { w?: unknown; h?: unknown } = {}) {
  const hRaw = overrides.h === undefined || overrides.h === "" ? cfg.paperHeightMm : Number(overrides.h) === 0 ? null : clampInt(overrides.h, PAPER_LIMITS.heightMm, cfg.paperHeightMm ?? 200);
  return {
    widthMm: clampInt(overrides.w === undefined || overrides.w === "" ? cfg.paperWidthMm : overrides.w, PAPER_LIMITS.widthMm, cfg.paperWidthMm),
    heightMm: hRaw,
    marginMm: cfg.marginMm,
    fontPt: cfg.fontSizeTenthPt / 10,
  };
}

// --- the key a printer program uses to collect jobs -----------------------------------

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Make a new key for the printer program. It is shown once; only a fingerprint is kept, so a lost key is replaced, not recovered. */
export async function createAgentKey(ctx: TenantContext): Promise<string> {
  if (!can(ctx, "print.manage")) throw new DomainError("You do not have permission to change print settings.");
  const token = `pk_${randomBytes(24).toString("base64url")}`;
  await db.$transaction(async (tx) => {
    await tx.printSetting.upsert({
      where: { businessId: ctx.businessId },
      create: { businessId: ctx.businessId, agentKeyHash: hash(token) },
      update: { agentKeyHash: hash(token) },
    });
    await audit(tx, ctx, "print.agentKey", "Business", ctx.businessId);
  });
  return token;
}

/** The business a printer-program key belongs to, or null. */
export async function businessForAgentKey(token: string | null): Promise<string | null> {
  if (!token || !token.startsWith("pk_") || token.length < 20 || token.length > 100) return null;
  const row = await db.printSetting.findFirst({ where: { agentKeyHash: hash(token) }, select: { businessId: true } });
  return row?.businessId ?? null;
}

export async function hasAgentKey(businessId: string): Promise<boolean> {
  return !!(await db.printSetting.findUnique({ where: { businessId }, select: { agentKeyHash: true } }))?.agentKeyHash;
}
