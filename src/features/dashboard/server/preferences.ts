import { db } from "@/server/db";
import { Prisma } from "@/generated/prisma/client";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { cleanAccent, cleanMode, effectiveAccent, type ThemeMode } from "@/features/appearance/theme";
import { cleanTemplate, parseConfig, resolveLayout, toDeviceLayout, type DashboardConfig, type Device, type Placed, type Template } from "../layout";
import { availableWidgets, TEMPLATE_ORDER, WIDGETS } from "../registry";

/**
 * A person's own look and dashboard (one row per person per business) and the business's default accent colour. Every query is keyed by
 * ctx.userId and ctx.businessId, so nobody can read or change another person's or another business's settings.
 */

export interface Preferences {
  themeMode: ThemeMode;
  accent: string | null;
  template: Template;
  layout: DashboardConfig | null;
}

const NONE: Preferences = { themeMode: "SYSTEM", accent: null, template: "CLASSIC", layout: null };

export async function getPreferences(ctx: TenantContext): Promise<Preferences> {
  const row = await db.userPreference.findUnique({ where: { userId_businessId: { userId: ctx.userId, businessId: ctx.businessId } } });
  if (!row) return { ...NONE };
  let layout: DashboardConfig | null = null;
  if (row.dashboardLayout) {
    try {
      layout = parseConfig(row.dashboardLayout, WIDGETS);
    } catch {
      layout = null; // a stored layout that no longer parses falls back to the template default
    }
  }
  let accent: string | null = null;
  try {
    accent = row.accent ? cleanAccent(row.accent) : null;
  } catch {
    accent = null;
  }
  return { themeMode: cleanMode(row.themeMode), accent, template: cleanTemplate(row.dashboardTemplate), layout };
}

const where = (ctx: TenantContext) => ({ userId_businessId: { userId: ctx.userId, businessId: ctx.businessId } });

type Change = Partial<{ themeMode: string; accent: string | null; dashboardTemplate: string; dashboardLayout: Prisma.InputJsonValue | typeof Prisma.DbNull }>;

async function upsert(ctx: TenantContext, data: Change) {
  await db.userPreference.upsert({
    where: where(ctx),
    create: { userId: ctx.userId, businessId: ctx.businessId, ...data },
    update: data,
  });
}

/** Save the layout. Only widgets this person may have are kept; the rest of the config is cleaned by parseConfig. */
export async function saveLayout(ctx: TenantContext, raw: unknown) {
  const allowed = availableWidgets(ctx);
  const cfg = parseConfig(raw, allowed);
  await upsert(ctx, { dashboardLayout: cfg as unknown as Prisma.InputJsonValue });
  return cfg;
}

/** Back to the template's standard layout. */
export async function resetLayout(ctx: TenantContext) {
  await upsert(ctx, { dashboardLayout: Prisma.DbNull });
}

/** Choosing a template never touches the saved layout or hidden widgets. */
export async function saveTemplate(ctx: TenantContext, template: string) {
  const t = cleanTemplate(template);
  if (t !== template) throw new DomainError("Choose one of the three layouts.");
  await upsert(ctx, { dashboardTemplate: t });
}

export async function saveAppearance(ctx: TenantContext, input: { themeMode: string; accent: string | null }) {
  await upsert(ctx, { themeMode: cleanMode(input.themeMode), accent: input.accent ? cleanAccent(input.accent) : null });
}

/** The business-wide default accent colour. Owner only. */
export async function saveBusinessAccent(ctx: TenantContext, accent: string | null) {
  if (!can(ctx, "owner.control")) throw new DomainError("Only the owner can change the business colour.");
  const value = accent ? cleanAccent(accent) : null;
  await db.$transaction(async (tx) => {
    await tx.business.update({ where: { id: ctx.businessId }, data: { brandAccent: value } });
    await audit(tx, ctx, "business.accent", "Business", ctx.businessId, { accent: value ?? "default" });
  });
}

/** What the app shell needs on every page: mode and the colour in force. */
export async function getTheme(ctx: TenantContext) {
  const [p, biz] = await Promise.all([getPreferences(ctx), db.business.findUnique({ where: { id: ctx.businessId }, select: { brandAccent: true } })]);
  return { mode: p.themeMode, accent: effectiveAccent(p.accent, biz?.brandAccent) };
}

/** What the editor and the visibility list start from: both devices as they are now, and the template's standard layout. */
export async function getEditorState(ctx: TenantContext) {
  const p = await getPreferences(ctx);
  const available = availableWidgets(ctx);
  const order = TEMPLATE_ORDER[p.template];
  const now = (d: Device) => resolveLayout(p.layout?.[d] ?? null, available, order);
  const std = () => resolveLayout(null, available, order);
  return {
    template: p.template,
    widgets: available,
    current: { desktop: now("desktop"), mobile: now("mobile") },
    defaults: { desktop: std(), mobile: std() },
    customised: p.layout !== null,
  };
}

/** Show exactly these widgets on every device and hide the rest, keeping each device's order and sizes. */
export async function setWidgetVisibility(ctx: TenantContext, visibleIds: string[]) {
  const st = await getEditorState(ctx);
  const keep = new Set(visibleIds);
  const one = (r: { visible: Placed[]; hidden: Placed[] }) => {
    const all = [...r.visible, ...r.hidden];
    return toDeviceLayout(all.filter((p) => keep.has(p.id)), all.filter((p) => !keep.has(p.id)));
  };
  return saveLayout(ctx, { v: 1, desktop: one(st.current.desktop), mobile: one(st.current.mobile) });
}
