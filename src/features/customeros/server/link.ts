import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { seal, unseal } from "@/lib/secretbox";
import { cleanBaseUrl, cosPing, type CosTarget, type FetchLike } from "../client";

/**
 * The owner's connection to Customer OS. Owner only. Connecting checks the key against Customer OS first, stores it
 * encrypted, and switches this app's own points off so a bill is never rewarded twice.
 */

const need = (ctx: TenantContext) => {
  if (!can(ctx, "owner.control")) throw new DomainError("Only the owner can connect Customer OS.");
};

export interface LinkStatus {
  connected: boolean;
  enabled: boolean;
  baseUrl: string | null;
  keyPrefix: string | null;
  lastOkAt: Date | null;
  lastError: string | null;
  /** The saved key can no longer be read (SESSION_SECRET changed): the owner must enter it again. */
  keyUnreadable: boolean;
  counts: { pending: number; failed: number; sent: number };
}

export async function getLinkStatus(ctx: TenantContext): Promise<LinkStatus> {
  need(ctx);
  const link = await db.customerOsLink.findUnique({ where: { businessId: ctx.businessId } });
  const grouped = await db.customerOsEvent.groupBy({ by: ["status"], where: { businessId: ctx.businessId }, _count: { _all: true } });
  const count = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;
  return {
    connected: !!link,
    enabled: link?.enabled ?? false,
    baseUrl: link?.baseUrl ?? null,
    keyPrefix: link?.keyPrefix ?? null,
    lastOkAt: link?.lastOkAt ?? null,
    lastError: link?.lastError ?? null,
    keyUnreadable: link ? unseal(link.keyEnc) === null : false,
    counts: { pending: count("PENDING"), failed: count("FAILED"), sent: count("SENT") },
  };
}

/** The address and key to call Customer OS with, plus whether sending is switched on. Null when not connected. */
export async function loadTarget(businessId: string): Promise<{ target: CosTarget; enabled: boolean } | null> {
  const link = await db.customerOsLink.findUnique({ where: { businessId } });
  if (!link) return null;
  const key = unseal(link.keyEnc);
  if (!key) return null;
  return { target: { baseUrl: link.baseUrl, key }, enabled: link.enabled };
}

/** Checks the key, then saves the connection. Nothing is saved if Customer OS refuses the key. */
export async function saveLink(
  ctx: TenantContext,
  input: { baseUrl: string; key: string },
  opts: { fetchImpl?: FetchLike } = {},
): Promise<{ business: string }> {
  need(ctx);
  const baseUrl = cleanBaseUrl(input.baseUrl);
  if (!baseUrl) throw new DomainError("Enter the Customer OS address, like https://customers.example.com");
  const key = input.key.trim();
  if (!key.startsWith("cos_live_") || key.length < 20) throw new DomainError("That does not look like a Customer OS key. Make one in Customer OS under Settings, then Integrations.");

  const ping = await cosPing({ baseUrl, key }, { fetchImpl: opts.fetchImpl });
  if (!ping.ok) {
    throw new DomainError(ping.status === 401 ? "Customer OS did not accept that key." : `Could not connect: ${ping.message}`);
  }
  await db.$transaction(async (tx) => {
    await tx.customerOsLink.upsert({
      where: { businessId: ctx.businessId },
      create: { businessId: ctx.businessId, baseUrl, keyEnc: seal(key), keyPrefix: key.slice(0, 14), enabled: true, lastOkAt: new Date() },
      update: { baseUrl, keyEnc: seal(key), keyPrefix: key.slice(0, 14), enabled: true, lastOkAt: new Date(), lastError: null },
    });
    // Customer OS now owns points. Turning this app's own earning off stops a bill being rewarded in both places.
    await tx.business.update({ where: { id: ctx.businessId }, data: { loyaltyEnabled: false } });
    // Bills paid while the key was being replaced are retried, not lost.
    await tx.customerOsEvent.updateMany({
      where: { businessId: ctx.businessId, status: "FAILED", lastError: { startsWith: "Customer OS did not accept" } },
      data: { status: "PENDING", nextAttemptAt: new Date() },
    });
    await audit(tx, ctx, "customeros.connected", "Business", ctx.businessId, { host: new URL(baseUrl).host });
  });
  return { business: ping.data.business };
}

export async function setSending(ctx: TenantContext, enabled: boolean): Promise<void> {
  need(ctx);
  const done = await db.customerOsLink.updateMany({ where: { businessId: ctx.businessId }, data: { enabled } });
  if (done.count === 0) throw new DomainError("Customer OS is not connected.");
  await db.$transaction((tx) => audit(tx, ctx, enabled ? "customeros.resumed" : "customeros.paused", "Business", ctx.businessId));
}

/** Removes the connection and the stored key. Bills already waiting stay recorded here; they are simply not sent. */
export async function disconnect(ctx: TenantContext): Promise<void> {
  need(ctx);
  await db.$transaction(async (tx) => {
    await tx.customerOsLink.deleteMany({ where: { businessId: ctx.businessId } });
    await audit(tx, ctx, "customeros.disconnected", "Business", ctx.businessId);
  });
}
