"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { postStockValue } from "@/features/accounting/server/extras";

/** Bring the books' stock figure in line with what the shelves are worth now. */
export async function postStockValueAction() {
  const ctx = await requireTenant("books.manage");
  const r = await guarded("/stock/value", () => postStockValue(ctx));
  revalidatePath("/accounting", "layout");
  redirect(`/stock/value?posted=${r.posted}`);
}
