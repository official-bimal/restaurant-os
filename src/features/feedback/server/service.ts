import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { pushToTeam } from "@/features/notifications/server/push";
import { Prisma } from "@/generated/prisma/client";
import {
  cleanComment,
  cleanReviewUrl,
  isValidRating,
  LOW_RATING_MAX,
  publicDishRating,
  summarizeDishRatings,
  summarizeRatings,
  withinWindow,
} from "@/features/feedback/rating";

/**
 * Guest feedback. A guest can rate only a visit that was actually paid: the proof is their
 * table sitting, which ended with an invoice. One rating per invoice; a repeat tap updates it.
 * Feedback carries no name or phone, and staff queries are filtered by businessId.
 */

type Claims = { sessionId: string; tableId: string };

/** The paid, closed sitting these claims point at, or null. */
async function paidSitting(claims: Claims | null) {
  if (!claims) return null;
  const session = await db.tableSession.findFirst({
    where: { id: claims.sessionId, tableId: claims.tableId, closedAt: { not: null }, closeReason: "PAID", closedByInvoiceId: { not: null } },
  });
  if (!session || !session.closedAt || !session.closedByInvoiceId) return null;
  const [invoice, business] = await Promise.all([
    db.invoice.findFirst({ where: { id: session.closedByInvoiceId, businessId: session.businessId }, select: { id: true } }),
    db.business.findUniqueOrThrow({
      where: { id: session.businessId },
      select: { feedbackEnabled: true, googleReviewUrl: true },
    }),
  ]);
  if (!invoice) return null;
  return { businessId: session.businessId, invoiceId: invoice.id, closedAt: session.closedAt, business };
}

// --- guest side ----------------------------------------------------------------

export async function getFeedbackState(claims: Claims | null) {
  const sitting = await paidSitting(claims);
  if (!sitting || !sitting.business.feedbackEnabled) return null;
  const existing = await db.feedback.findUnique({
    where: { businessId_invoiceId: { businessId: sitting.businessId, invoiceId: sitting.invoiceId } },
    select: { rating: true, comment: true },
  });
  return {
    rating: existing?.rating ?? null,
    comment: existing?.comment ?? null,
    canSubmit: withinWindow(sitting.closedAt),
    // Offered to everyone who rates, whatever the rating: pointing only happy guests to a
    // public review site is "review gating", which Google's policy forbids.
    googleReviewUrl: sitting.business.googleReviewUrl,
    lowRating: existing ? existing.rating <= LOW_RATING_MAX : false,
  };
}

async function requireOpenWindow(claims: Claims | null) {
  const sitting = await paidSitting(claims);
  if (!sitting) throw new DomainError("We can only take feedback for a visit that has been paid.");
  if (!sitting.business.feedbackEnabled) throw new DomainError("Feedback is not being collected right now.");
  if (!withinWindow(sitting.closedAt)) throw new DomainError("Feedback for this visit has closed. Thank you for coming.");
  return sitting;
}

export async function submitRating(claims: Claims | null, rating: unknown) {
  if (!isValidRating(rating)) throw new DomainError("Choose between one and five stars.");
  const sitting = await requireOpenWindow(claims);
  const key = { businessId_invoiceId: { businessId: sitting.businessId, invoiceId: sitting.invoiceId } };
  try {
    await db.feedback.upsert({
      where: key,
      create: { businessId: sitting.businessId, invoiceId: sitting.invoiceId, rating },
      update: { rating },
    });
  } catch (e) {
    // Two taps raced to create it: the second just updates.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      await db.feedback.update({ where: key, data: { rating } });
    } else {
      throw e;
    }
  }
  // A low rating needs someone to look into it while the guest may still be at the table.
  if (rating <= LOW_RATING_MAX) {
    void pushToTeam({
      businessId: sitting.businessId,
      permission: "feedback.view",
      payload: { title: `A guest gave ${rating} star${rating === 1 ? "" : "s"}`, body: "Open Feedback to look into it.", url: "/feedback", tag: "low-rating" },
    });
  }
  return { rating };
}

export async function submitComment(claims: Claims | null, comment: string) {
  const sitting = await requireOpenWindow(claims);
  let clean: string | null;
  try {
    clean = cleanComment(comment);
  } catch (e) {
    throw new DomainError((e as Error).message);
  }
  const key = { businessId_invoiceId: { businessId: sitting.businessId, invoiceId: sitting.invoiceId } };
  const existing = await db.feedback.findUnique({ where: key, select: { id: true } });
  if (!existing) throw new DomainError("Please choose a star rating first.");
  await db.feedback.update({ where: key, data: { comment: clean } });
}

// --- dish ratings (guest side) ----------------------------------------------------

/** The dishes on the paid bill, each with the guest's rating so far, for the "rate what you had" list. */
export async function getDishRatingState(claims: Claims | null) {
  const sitting = await paidSitting(claims);
  if (!sitting || !sitting.business.feedbackEnabled) return null;
  const invoice = await db.invoice.findFirst({
    where: { id: sitting.invoiceId, businessId: sitting.businessId },
    select: { order: { select: { items: { where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" }, select: { menuItemId: true, name: true } } } } },
  });
  const seen = new Map<string, string>();
  for (const i of invoice?.order.items ?? []) if (!seen.has(i.menuItemId)) seen.set(i.menuItemId, i.name);
  const given = await db.dishRating.findMany({ where: { businessId: sitting.businessId, invoiceId: sitting.invoiceId }, select: { menuItemId: true, rating: true } });
  const byDish = new Map(given.map((g) => [g.menuItemId, g.rating]));
  return {
    canSubmit: withinWindow(sitting.closedAt),
    dishes: [...seen].map(([menuItemId, name]) => ({ menuItemId, name, rating: byDish.get(menuItemId) ?? null })),
  };
}

/** Rate one dish from this paid visit (a repeat updates it). Only a dish that was really on the bill can be rated. */
export async function submitDishRating(claims: Claims | null, menuItemId: string, rating: unknown) {
  if (!isValidRating(rating)) throw new DomainError("Choose between one and five stars.");
  const sitting = await requireOpenWindow(claims);
  const onBill = await db.orderItem.findFirst({
    where: { businessId: sitting.businessId, menuItemId, status: { not: "CANCELLED" }, order: { invoice: { id: sitting.invoiceId } } },
    select: { id: true },
  });
  if (!onBill) throw new DomainError("That dish was not on your bill.");
  const key = { businessId_invoiceId_menuItemId: { businessId: sitting.businessId, invoiceId: sitting.invoiceId, menuItemId } };
  try {
    await db.dishRating.upsert({ where: key, create: { businessId: sitting.businessId, invoiceId: sitting.invoiceId, menuItemId, rating }, update: { rating } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") await db.dishRating.update({ where: key, data: { rating } });
    else throw e;
  }
  return { rating };
}

/** Public stars per dish (only dishes with enough ratings are included). Just numbers: nothing about who rated. */
export async function dishRatingsFor(businessId: string, menuItemIds: string[]): Promise<Record<string, { average: number; count: number }>> {
  if (menuItemIds.length === 0) return {};
  const rows = await db.dishRating.groupBy({ by: ["menuItemId"], where: { businessId, menuItemId: { in: menuItemIds } }, _sum: { rating: true }, _count: { _all: true } });
  const out: Record<string, { average: number; count: number }> = {};
  for (const r of rows) {
    const pub = publicDishRating(r._sum.rating ?? 0, r._count._all);
    if (pub) out[r.menuItemId] = pub;
  }
  return out;
}

// --- staff side ----------------------------------------------------------------

function need(ctx: TenantContext) {
  if (!can(ctx, "feedback.view")) throw new DomainError("You do not have permission to see feedback.");
}

export async function listFeedback(ctx: TenantContext, days = 30) {
  need(ctx);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [rows, unresolved] = await Promise.all([
    db.feedback.findMany({
      where: { businessId: ctx.businessId, createdAt: { gte: since } },
      include: { invoice: { select: { number: true, grandTotal: true, order: { select: { table: { select: { label: true } } } } } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    unresolvedCount(ctx),
  ]);
  return { summary: summarizeRatings(rows.map((r) => r.rating)), items: rows, unresolved, days };
}

/** Staff view: each dish guests rated in the last `days` days, lowest average first. Anonymous: only counts, never who rated. */
export async function listDishRatings(ctx: TenantContext, days = 30) {
  need(ctx);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const groups = await db.dishRating.groupBy({
    by: ["menuItemId", "rating"],
    where: { businessId: ctx.businessId, createdAt: { gte: since } },
    _count: { _all: true },
  });
  const ids = [...new Set(groups.map((g) => g.menuItemId))];
  const dishes = ids.length ? await db.menuItem.findMany({ where: { businessId: ctx.businessId, id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(dishes.map((d) => [d.id, d.name]));
  const dist = new Map<string, [number, number, number, number, number]>();
  for (const g of groups) {
    if (!isValidRating(g.rating)) continue;
    const d = dist.get(g.menuItemId) ?? [0, 0, 0, 0, 0];
    d[g.rating - 1] += g._count._all;
    dist.set(g.menuItemId, d);
  }
  return { days, lines: summarizeDishRatings([...dist].map(([menuItemId, distribution]) => ({ menuItemId, name: names.get(menuItemId) ?? "Removed dish", distribution }))) };
}

/** Low ratings nobody has looked into yet (all time): the number on the nav badge. */
export async function unresolvedCount(ctx: TenantContext): Promise<number> {
  if (!can(ctx, "feedback.view")) return 0;
  return db.feedback.count({ where: { businessId: ctx.businessId, rating: { lte: LOW_RATING_MAX }, handledAt: null } });
}

export async function resolveFeedback(ctx: TenantContext, id: string, rawNote: string) {
  need(ctx);
  const note = rawNote.trim().replace(/\s+/g, " ");
  if (note.length < 3) throw new DomainError("Write what was done about it (a few words).");
  if (note.length > 300) throw new DomainError("The note is too long (300 characters at most).");
  await db.$transaction(async (tx) => {
    const res = await tx.feedback.updateMany({
      where: { id, businessId: ctx.businessId, handledAt: null },
      data: { handledAt: new Date(), handledById: ctx.userId, handledNote: note },
    });
    if (res.count === 0) {
      const exists = await tx.feedback.findFirst({ where: { id, businessId: ctx.businessId }, select: { id: true } });
      throw new DomainError(exists ? "That feedback was already handled." : "Feedback not found.");
    }
    await audit(tx, ctx, "feedback.handle", "Feedback", id, { note });
  });
}

export async function getFeedbackSettings(ctx: TenantContext) {
  need(ctx);
  return db.business.findUniqueOrThrow({
    where: { id: ctx.businessId },
    select: { feedbackEnabled: true, googleReviewUrl: true },
  });
}

export async function setFeedbackSettings(ctx: TenantContext, input: { enabled: boolean; googleReviewUrl: string }) {
  need(ctx);
  let url: string | null;
  try {
    url = cleanReviewUrl(input.googleReviewUrl);
  } catch (e) {
    throw new DomainError((e as Error).message);
  }
  await db.$transaction(async (tx) => {
    await tx.business.update({ where: { id: ctx.businessId }, data: { feedbackEnabled: input.enabled, googleReviewUrl: url } });
    await audit(tx, ctx, "feedback.settings", "Business", ctx.businessId, { enabled: input.enabled, hasReviewLink: !!url });
  });
}
