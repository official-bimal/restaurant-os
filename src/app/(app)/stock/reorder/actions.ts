"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { createDraftFromReorder, setItemSupply, setSupplierLeadDays } from "@/features/purchasing/server/reorder";

const id = z.string().min(1).max(60);

function params(formData: FormData) {
  const w = Number(formData.get("windowDays") || 28);
  const c = Number(formData.get("coverDays") || 7);
  return { windowDays: w, coverDays: c, qs: `?window=${w}&cover=${c}` };
}

export async function makeDraftAction(supplierId: string, formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const p = params(formData);
  const back = `/stock/reorder${p.qs}`;
  const po = await guarded(back, () =>
    createDraftFromReorder(ctx, {
      supplierId: supplierId === "none" ? "none" : id.parse(supplierId),
      chooseSupplierId: String(formData.get("chooseSupplierId") || "") || undefined,
      windowDays: p.windowDays,
      coverDays: p.coverDays,
    }),
  );
  revalidatePath("/stock", "layout");
  redirect(`/stock/orders/${po.id}`);
}

export async function setSupplyAction(stockItemId: string, formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const p = params(formData);
  const back = `/stock/reorder${p.qs}`;
  await guarded(back, () =>
    setItemSupply(ctx, id.parse(stockItemId), {
      supplierId: String(formData.get("supplierId") || "") || null,
      packQuantity: Math.floor(Number(formData.get("packQuantity") || 1)),
    }),
  );
  revalidatePath("/stock/reorder");
  redirect(back);
}

export async function setLeadAction(supplierId: string, formData: FormData) {
  const ctx = await requireTenant("stock.manage");
  const p = params(formData);
  const back = `/stock/reorder${p.qs}`;
  await guarded(back, () => setSupplierLeadDays(ctx, id.parse(supplierId), Math.floor(Number(formData.get("leadDays") ?? 2))));
  revalidatePath("/stock/reorder");
  redirect(back);
}
