import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { audit } from "@/server/audit";
import { menuToCsv, parseMenuCsv, planImport, summarize, type ExistingDish, type ParsedMenu, type PlanItem } from "../menu-csv";

/**
 * The menu as a spreadsheet: download it, change prices or add dishes in Excel, upload it back. An upload is checked first and shows what it
 * would add and change; nothing is saved until it is applied, and the plan is worked out again at that moment from the file itself. A dish is never deleted by an upload
 * (a dish left out of the file stays as it is). Only people who manage the menu. Every query is filtered by businessId.
 */

const MAX_BYTES = 1_000_000;

function need(ctx: TenantContext) {
  if (!can(ctx.role, "menu.manage")) throw new DomainError("You do not have permission to change the menu.");
}

async function existingDishes(businessId: string): Promise<ExistingDish[]> {
  const rows = await db.menuItem.findMany({
    where: { businessId },
    select: { id: true, name: true, nameNe: true, price: true, prepMinutes: true, available: true, category: { select: { name: true, sortOrder: true } }, station: { select: { name: true } } },
    orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
  });
  return rows.map((r) => ({ id: r.id, name: r.name, category: r.category.name, nameNe: r.nameNe, price: r.price, station: r.station?.name ?? null, prepMinutes: r.prepMinutes, available: r.available }));
}

export async function exportMenuCsv(ctx: TenantContext): Promise<string> {
  need(ctx);
  return menuToCsv(await existingDishes(ctx.businessId));
}

export interface ImportPreview {
  parsed: ParsedMenu;
  plan: PlanItem[];
  counts: { add: number; update: number; same: number; errors: number };
}

function checkText(text: string) {
  if (typeof text !== "string" || text.length === 0) throw new DomainError("Choose a file first.");
  if (text.length > MAX_BYTES) throw new DomainError("That file is too big. Split it into smaller files.");
}

export async function previewMenuImport(ctx: TenantContext, text: string): Promise<ImportPreview> {
  need(ctx);
  checkText(text);
  const parsed = parseMenuCsv(text);
  const plan = planImport(parsed.rows, await existingDishes(ctx.businessId));
  return { parsed, plan, counts: { ...summarize(plan), errors: parsed.errors.length } };
}

/** Saves the good rows of the file. Rows with a problem are skipped and reported; the rest are applied together or not at all. */
export async function applyMenuImport(ctx: TenantContext, text: string) {
  need(ctx);
  checkText(text);
  const parsed = parseMenuCsv(text);
  if (parsed.rows.length === 0) throw new DomainError(parsed.errors[0]?.message ?? "There is nothing to import.");
  return db.$transaction(async (tx) => {
    const businessId = ctx.businessId;
    const cats = new Map((await tx.menuCategory.findMany({ where: { businessId }, select: { id: true, name: true } })).map((c) => [c.name.toLowerCase(), c.id]));
    const stations = new Map((await tx.station.findMany({ where: { businessId }, select: { id: true, name: true } })).map((s) => [s.name.toLowerCase(), s.id]));
    let order = (await tx.menuCategory.aggregate({ where: { businessId }, _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    const current = await tx.menuItem.findMany({
      where: { businessId },
      select: { id: true, name: true, nameNe: true, price: true, prepMinutes: true, available: true, category: { select: { name: true } }, station: { select: { name: true } } },
    });
    const plan = planImport(
      parsed.rows,
      current.map((r) => ({ id: r.id, name: r.name, category: r.category.name, nameNe: r.nameNe, price: r.price, station: r.station?.name ?? null, prepMinutes: r.prepMinutes, available: r.available })),
    );
    let added = 0;
    let updated = 0;
    for (const p of plan) {
      if (p.action === "SAME") continue;
      const r = p.row;
      const catName = r.category ?? (p.action === "ADD" ? "Menu" : null);
      let categoryId: string | undefined;
      if (catName) {
        categoryId = cats.get(catName.toLowerCase());
        if (!categoryId) {
          categoryId = (await tx.menuCategory.create({ data: { businessId, name: catName, sortOrder: ++order } })).id;
          cats.set(catName.toLowerCase(), categoryId);
        }
      }
      let stationId: string | undefined;
      if (r.station) {
        stationId = stations.get(r.station.toLowerCase());
        if (!stationId) {
          stationId = (await tx.station.create({ data: { businessId, name: r.station } })).id;
          stations.set(r.station.toLowerCase(), stationId);
        }
      }
      const data = { ...(categoryId ? { categoryId } : {}), name: r.name, price: r.price, ...(r.prepMinutes !== null ? { prepMinutes: r.prepMinutes } : {}), ...(r.available !== null ? { available: r.available } : {}), ...(r.nameNe !== null ? { nameNe: r.nameNe } : {}), ...(stationId ? { stationId } : {}) };
      if (p.action === "ADD") {
        await tx.menuItem.create({ data: { businessId, ...data, categoryId: categoryId! } });
        added++;
      } else {
        await tx.menuItem.update({ where: { businessId_id: { businessId, id: p.existingId! } }, data });
        updated++;
      }
    }
    await audit(tx, ctx, "menu.import", "Business", businessId, { added, updated, skipped: parsed.errors.length });
    return { added, updated, unchanged: plan.length - added - updated, skipped: parsed.errors };
  });
}
