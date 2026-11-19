"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { DomainError } from "@/server/errors";
import { createAccount, createVoucher, reverseVoucher, updateAccount } from "@/features/accounting/server/service";

const idSchema = z.string().min(1).max(60);

/** Rupees typed on a form (like "1,250.50") as whole paisa; empty is zero. */
function paisa(raw: FormDataEntryValue | null): number {
  const t = String(raw ?? "").replace(/,/g, "").trim();
  if (!t) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new DomainError("Enter amounts as numbers, like 1250 or 1250.50.");
  return Math.round(Number(t) * 100);
}

export async function createVoucherAction(formData: FormData) {
  const ctx = await requireTenant("books.manage");
  const back = "/accounting/voucher";
  await guarded(back, async () => {
    const lines: { accountId: string; debit: number; credit: number; narration?: string }[] = [];
    for (let i = 0; i < 8; i++) {
      const accountId = String(formData.get(`account${i}`) ?? "");
      const debit = paisa(formData.get(`debit${i}`));
      const credit = paisa(formData.get(`credit${i}`));
      if (!accountId && !debit && !credit) continue;
      if (!accountId) throw new DomainError("Choose an account for each line that has an amount.");
      lines.push({ accountId: idSchema.parse(accountId), debit, credit });
    }
    await createVoucher(ctx, {
      voucher: String(formData.get("voucher") ?? ""),
      date: String(formData.get("date") ?? ""),
      narration: String(formData.get("narration") ?? ""),
      lines,
    });
  });
  revalidatePath("/accounting", "layout");
  redirect(`/accounting/daybook?to=${encodeURIComponent(String(formData.get("date") ?? ""))}&from=${encodeURIComponent(String(formData.get("date") ?? ""))}`);
}

export async function reverseVoucherAction(back: string, entryId: string, formData: FormData) {
  const ctx = await requireTenant("books.manage");
  const safe = back.startsWith("/accounting/") ? back : "/accounting/daybook";
  await guarded(safe, () => reverseVoucher(ctx, idSchema.parse(entryId), String(formData.get("reason") ?? "")));
  revalidatePath("/accounting", "layout");
  redirect(safe);
}

export async function createAccountAction(formData: FormData) {
  const ctx = await requireTenant("books.manage");
  await guarded("/accounting/accounts", () =>
    createAccount(ctx, { code: String(formData.get("code") ?? ""), name: String(formData.get("name") ?? ""), type: String(formData.get("type") ?? "") }),
  );
  revalidatePath("/accounting", "layout");
  redirect("/accounting/accounts");
}

export async function updateAccountAction(id: string, formData: FormData) {
  const ctx = await requireTenant("books.manage");
  const active = formData.get("active");
  await guarded("/accounting/accounts", () =>
    updateAccount(ctx, idSchema.parse(id), {
      name: formData.has("name") ? String(formData.get("name")) : undefined,
      active: active === null ? undefined : active === "1",
    }),
  );
  revalidatePath("/accounting", "layout");
  redirect("/accounting/accounts");
}
