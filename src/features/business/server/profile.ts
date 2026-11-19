import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { detectImageType } from "@/features/menu/image";
import { cleanProfile, MAX_LOGO_BYTES, type ProfileInput } from "../profile";

function need(ctx: TenantContext) {
  if (!can(ctx.role, "owner.control")) throw new DomainError("Only the owner can change the business profile.");
}

export async function getProfile(ctx: TenantContext) {
  need(ctx);
  const [b, logo] = await Promise.all([
    db.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: { name: true, legalName: true, panNumber: true, phone: true, email: true, address: true, businessType: true, openedOn: true, website: true, facebook: true, instagram: true, timezone: true },
    }),
    db.businessLogo.findUnique({ where: { businessId: ctx.businessId }, select: { updatedAt: true } }),
  ]);
  return { ...b, hasLogo: !!logo, logoVersion: logo?.updatedAt.getTime() ?? 0 };
}

export async function saveProfile(ctx: TenantContext, input: ProfileInput) {
  need(ctx);
  const data = cleanProfile(input);
  await db.$transaction(async (tx) => {
    await tx.business.update({ where: { id: ctx.businessId }, data });
    await audit(tx, ctx, "business.profile", "Business", ctx.businessId, { fields: Object.keys(data) });
  });
}

export async function setLogo(ctx: TenantContext, data: Uint8Array) {
  need(ctx);
  if (data.length === 0) throw new DomainError("Choose a picture first.");
  if (data.length > MAX_LOGO_BYTES) throw new DomainError("That picture is too big. Choose one under 300 KB.");
  const contentType = detectImageType(data);
  if (!contentType) throw new DomainError("Use a JPEG, PNG or WebP picture.");
  const bytes = Buffer.from(data);
  await db.$transaction(async (tx) => {
    await tx.businessLogo.upsert({
      where: { businessId: ctx.businessId },
      create: { businessId: ctx.businessId, contentType, bytes: data.length, data: bytes },
      update: { contentType, bytes: data.length, data: bytes },
    });
    await audit(tx, ctx, "business.logo", "Business", ctx.businessId, { bytes: data.length });
  });
}

export async function removeLogo(ctx: TenantContext) {
  need(ctx);
  await db.$transaction(async (tx) => {
    await tx.businessLogo.deleteMany({ where: { businessId: ctx.businessId } });
    await audit(tx, ctx, "business.logoRemove", "Business", ctx.businessId);
  });
}

/** For the logo route: signed-in staff of the business only. */
export async function getLogo(ctx: TenantContext) {
  const l = await db.businessLogo.findUnique({ where: { businessId: ctx.businessId }, select: { contentType: true, data: true } });
  return l ?? null;
}
