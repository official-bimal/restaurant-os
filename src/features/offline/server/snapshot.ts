import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { listMenu, listTables } from "@/features/orders/server/service";
import { groupRulesForMenu } from "@/features/menu/server/pricing";
import { SNAPSHOT_MAX_AGE_DAYS, SNAPSHOT_VERSION, type OfflineSnapshot } from "../billing";

/**
 * The signed snapshot a phone takes with it: this branch's prices, the tax settings and the tables, as they are right now.
 * The server signs it (HMAC with the server's secret), so when a bill arrives later the server can tell the prices on it are
 * the real ones and were not changed on the phone. Prices on a bill always come from the snapshot, never from the phone's own
 * claim, and never from today's menu (a customer pays what the menu said when they paid).
 */

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return s;
}

export function sign(json: string): string {
  return createHmac("sha256", `offline-snapshot:${secret()}`).update(json).digest("base64url");
}

export interface SignedSnapshot {
  /** The snapshot as JSON text. Keep it exactly as given: the signature is over these exact characters. */
  snapshot: string;
  sig: string;
}

export async function makeSnapshot(ctx: TenantContext, now: Date = new Date()): Promise<SignedSnapshot> {
  if (!can(ctx.role, "order.create")) throw new DomainError("You do not have permission to take orders.");
  const [business, branch, menu, tables, rules] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: ctx.businessId } }),
    db.branch.findUniqueOrThrow({ where: { businessId_id: { businessId: ctx.businessId, id: ctx.branchId } }, select: { name: true, address: true } }),
    listMenu(ctx),
    listTables(ctx),
    groupRulesForMenu(db, ctx.businessId, ctx.branchId),
  ]);
  const snap: OfflineSnapshot = {
    v: SNAPSHOT_VERSION,
    issuedAt: now.toISOString(),
    businessId: ctx.businessId,
    branchId: ctx.branchId,
    userId: ctx.userId,
    business: {
      name: business.name,
      pan: business.panNumber,
      timezone: business.timezone,
      serviceChargeBps: business.serviceChargeBps,
      vatMode: business.vatMode,
      vatBps: business.vatBps,
      vatAppliesToServiceCharge: business.vatAppliesToServiceCharge,
      roundToRupee: business.roundToRupee,
    },
    branch: { name: branch.name, address: branch.address },
    // Only dishes that can be sold plain: a dish with a required choice (size, spice) needs the server.
    items: menu.flatMap((c) => c.items.filter((i) => !(rules.get(i.id) ?? []).some((g) => g.required)).map((i) => ({ id: i.id, name: i.name, price: i.price, category: c.name }))),
    tables: tables.map((t) => ({ id: t.id, label: `${t.area.name} · ${t.label}` })),
  };
  const json = JSON.stringify(snap);
  return { snapshot: json, sig: sign(json) };
}

/** Check a snapshot that came back from a phone. Throws if it was altered, is for another business or is too old. */
export function verifySnapshot(json: string, sig: string, ctx: Pick<TenantContext, "businessId" | "branchIds">, now: Date = new Date()): OfflineSnapshot {
  if (typeof json !== "string" || typeof sig !== "string" || json.length > 2_000_000) throw new DomainError("The menu on this phone is not valid. Connect to the internet to refresh it.");
  const expected = Buffer.from(sign(json));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new DomainError("The menu on this phone was changed or is not valid. Connect to the internet to refresh it.");
  const snap = JSON.parse(json) as OfflineSnapshot;
  if (snap.v !== SNAPSHOT_VERSION) throw new DomainError("The menu on this phone is from an older version of the app. Connect to the internet to refresh it.");
  if (snap.businessId !== ctx.businessId || !ctx.branchIds.includes(snap.branchId)) throw new DomainError("That menu belongs to another business or branch.");
  if (now.getTime() - Date.parse(snap.issuedAt) > (SNAPSHOT_MAX_AGE_DAYS + 30) * 86_400_000) throw new DomainError("The menu on this phone is far too old.");
  return snap;
}
