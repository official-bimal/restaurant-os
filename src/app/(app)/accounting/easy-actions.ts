"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { DomainError } from "@/server/errors";
import { addMoneyAccount, createEasyEntry } from "@/features/accounting/server/easy";

const id = z.string().min(1).max(60);

function paisa(raw: FormDataEntryValue | null): number {
  const t = String(raw ?? "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new DomainError("Enter the amount as a number, like 1250 or 1250.50.");
  return Math.round(Number(t) * 100);
}

export async function createEasyEntryAction(formData: FormData) {
  const ctx = await requireTenant("books.manage");
  const kind = String(formData.get("kind") ?? "INCOME");
  const back = `/accounting/new?kind=${encodeURIComponent(kind)}`;
  const date = String(formData.get("date") ?? "");
  await guarded(back, () =>
    createEasyEntry(ctx, {
      kind,
      date,
      amount: paisa(formData.get("amount")),
      moneyAccountId: id.parse(String(formData.get("money") ?? "")),
      otherAccountId: String(formData.get("other") ?? "") || undefined,
      party: String(formData.get("party") ?? ""),
      note: String(formData.get("note") ?? ""),
    }),
  );
  revalidatePath("/accounting", "layout");
  redirect(`/accounting/transactions?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}&saved=1`);
}

export async function addMoneyAccountAction(formData: FormData) {
  const ctx = await requireTenant("books.manage");
  await guarded("/accounting/cash-banks", () => addMoneyAccount(ctx, { name: String(formData.get("name") ?? "") }));
  revalidatePath("/accounting", "layout");
  redirect("/accounting/cash-banks");
}
