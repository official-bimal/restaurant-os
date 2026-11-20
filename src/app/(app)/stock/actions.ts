"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { DomainError } from "@/server/errors";
import { parseCounted } from "@/features/stock/count";
import { recordCountSheet } from "@/features/stock/server/counts";
import {
  archiveStockItem,
  createStockItem,
  recordCount,
  recordPurchase,
  recordWaste,
  setRecipe,
  setStockedHere,
  updateStockItem,
} from "@/features/stock/server/service";

const BACK = "/stock";

async function done(path = BACK): Promise<never> {
  revalidatePath("/stock", "layout");
  redirect(path);
}

const text = (max: number) => z.string().max(max);
const whole = (v: FormDataEntryValue | null) => Math.trunc(Number(v ?? 0));
const rupeesToPaisa = (v: FormDataEntryValue | null) => Math.round(Number(v ?? 0) * 100);

export async function createItemAction(formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const name = text(200).parse(formData.get("name") ?? "");
  const unit = text(20).parse(formData.get("unit") ?? "");
  await guarded(BACK, () => createStockItem(ctx, { name, unit, reorderLevel: whole(formData.get("reorderLevel")) }));
  await done();
}

export async function updateItemAction(id: string, formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const name = text(200).parse(formData.get("name") ?? "");
  await guarded(BACK, () => updateStockItem(ctx, id, { name, reorderLevel: whole(formData.get("reorderLevel")) }));
  await done();
}

export async function archiveItemAction(id: string) {
  const ctx = await requireTenant("stock.manage");
  await guarded(BACK, () => archiveStockItem(ctx, id));
  await done();
}

export async function purchaseAction(formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const stockItemId = text(60).parse(formData.get("stockItemId") ?? "");
  const supplier = text(200).parse(formData.get("supplier") ?? "");
  await guarded(BACK, () =>
    recordPurchase(ctx, {
      supplier,
      lines: [{ stockItemId, quantity: whole(formData.get("quantity")), totalCost: rupeesToPaisa(formData.get("totalRupees")) }],
    }),
  );
  await done();
}

export async function wasteAction(formData: FormData) {
  const ctx = await requireTenant("stock.waste");
  const stockItemId = text(60).parse(formData.get("stockItemId") ?? "");
  const reason = text(300).parse(formData.get("reason") ?? "");
  const category = text(30).parse(formData.get("category") ?? "");
  const back = text(40).parse(formData.get("back") ?? "") === "waste" ? "/stock/waste" : BACK;
  await guarded(back, () => recordWaste(ctx, { stockItemId, quantity: whole(formData.get("quantity")), reason, category }));
  await done(back);
}

/** A whole count sheet: every box "count_<id>" that is filled in is counted; blank boxes are left alone. */
export async function countSheetAction(formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const lines: { stockItemId: string; counted: number }[] = [];
  let bad = false;
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("count_")) continue;
    const counted = parseCounted(String(value));
    if (counted === "bad") bad = true;
    else if (counted !== null) lines.push({ stockItemId: name.slice(6), counted });
  }
  const note = text(300).parse(formData.get("note") ?? "");
  const sheet = await guarded("/stock/count", async () => {
    if (bad) throw new DomainError("Every amount must be a whole number, zero or more.");
    return recordCountSheet(ctx, { lines, note });
  });
  await done(`/stock/count/${sheet.id}`);
}

export async function countAction(formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const stockItemId = text(60).parse(formData.get("stockItemId") ?? "");
  const note = text(300).parse(formData.get("note") ?? "");
  await guarded(BACK, () => recordCount(ctx, { stockItemId, counted: whole(formData.get("counted")), note }));
  await done();
}

/** Every stock item arrives as a field "stock_<id>"; a blank or zero amount means "not in this recipe". */
export async function setRecipeAction(menuItemId: string, formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const lines: { stockItemId: string; quantity: number }[] = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("stock_")) continue;
    const quantity = whole(value as string);
    if (quantity > 0) lines.push({ stockItemId: name.slice(6), quantity });
  }
  await guarded("/stock/recipes", () => setRecipe(ctx, menuItemId, lines));
  await done("/stock/recipes");
}

/** Switch an item on or off for the branch you are working in (other branches are not affected). */
export async function setStockedAction(id: string, stocked: boolean) {
  const ctx = await requireTenant("stock.manage");
  await guarded(BACK, () => setStockedHere(ctx, id, stocked));
  await done();
}
