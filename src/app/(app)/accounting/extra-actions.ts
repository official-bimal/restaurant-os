"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { DomainError } from "@/server/errors";
import { addAsset, closeYear, disposeAsset, markReconciled, reopenYear, runDepreciation, saveBudgets, saveOpeningBalances, unmatchLine } from "@/features/accounting/server/extras";

const id = z.string().min(1).max(60);
const fyOf = (v: FormDataEntryValue | null) => z.string().regex(/^\d{4}\/\d{2}$/).parse(String(v ?? ""));

/** Rupees typed on a form (like "1,250.50") as whole paisa; empty is zero. */
function paisa(raw: FormDataEntryValue | null): number {
  const t = String(raw ?? "").replace(/,/g, "").trim();
  if (!t) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new DomainError("Enter amounts as numbers, like 1250 or 1250.50.");
  return Math.round(Number(t) * 100);
}

function done(path: string): never {
  revalidatePath("/accounting", "layout");
  redirect(path);
}

export async function openingBalancesAction(formData: FormData) {
  const ctx = await requireTenant("books.manage");
  const back = "/accounting/opening-balances";
  await guarded(back, async () => {
    const rows: { accountId: string; debit: number; credit: number }[] = [];
    for (const [k, v] of formData.entries()) {
      if (!k.startsWith("debit:")) continue;
      const accountId = id.parse(k.slice(6));
      const debit = paisa(v);
      const credit = paisa(formData.get(`credit:${accountId}`));
      if (debit && credit) throw new DomainError("An account is either a debit or a credit, not both.");
      if (debit || credit) rows.push({ accountId, debit, credit });
    }
    await saveOpeningBalances(ctx, { date: String(formData.get("date") ?? ""), rows });
  });
  done("/accounting/daybook?from=" + encodeURIComponent(String(formData.get("date"))) + "&to=" + encodeURIComponent(String(formData.get("date"))));
}

export async function closeYearAction(formData: FormData) {
  const ctx = await requireTenant("books.manage");
  const fy = fyOf(formData.get("fy"));
  await guarded("/accounting/year-end", () => closeYear(ctx, fy));
  done("/accounting/year-end");
}

export async function reopenYearAction(fy: string) {
  const ctx = await requireTenant("books.manage");
  await guarded("/accounting/year-end", () => reopenYear(ctx, fyOf(fy)));
  done("/accounting/year-end");
}

export async function reconcileAction(accountId: string, formData: FormData) {
  const ctx = await requireTenant("books.manage");
  const back = `/accounting/reconcile?account=${accountId}&to=${encodeURIComponent(String(formData.get("to") ?? ""))}&balance=${encodeURIComponent(String(formData.get("balance") ?? ""))}`;
  const ids = formData.getAll("line").map((v) => id.parse(String(v)));
  await guarded(back, () => markReconciled(ctx, id.parse(accountId), String(formData.get("statementDate") ?? ""), ids));
  done(back);
}

export async function unmatchAction(accountId: string, lineId: string, back: string) {
  const ctx = await requireTenant("books.manage");
  const safe = back.startsWith("/accounting/reconcile") ? back : "/accounting/reconcile";
  await guarded(safe, () => unmatchLine(ctx, id.parse(accountId), id.parse(lineId)));
  done(safe);
}

export async function addAssetAction(formData: FormData) {
  const ctx = await requireTenant("books.manage");
  await guarded("/accounting/assets", async () => {
    const pct = Number(String(formData.get("rate") ?? "").trim());
    if (!(pct > 0 && pct <= 100)) throw new DomainError("The yearly rate must be between 0.01 and 100 percent.");
    await addAsset(ctx, {
      name: String(formData.get("name") ?? ""),
      cost: paisa(formData.get("cost")),
      purchaseDate: String(formData.get("purchaseDate") ?? ""),
      rateBps: Math.round(pct * 100),
      paidFrom: String(formData.get("paidFrom") ?? ""),
    });
  });
  done("/accounting/assets");
}

export async function disposeAssetAction(assetId: string, formData: FormData) {
  const ctx = await requireTenant("books.manage");
  await guarded("/accounting/assets", () => disposeAsset(ctx, id.parse(assetId), String(formData.get("date") ?? "")));
  done("/accounting/assets");
}

export async function depreciationAction(formData: FormData) {
  const ctx = await requireTenant("books.manage");
  const fy = fyOf(formData.get("fy"));
  const r = await guarded("/accounting/assets", () => runDepreciation(ctx, fy));
  done(`/accounting/assets?done=${r.count}`);
}

export async function saveBudgetsAction(fy: string, formData: FormData) {
  const ctx = await requireTenant("books.manage");
  const back = `/accounting/budget?fy=${encodeURIComponent(fy)}`;
  await guarded(back, async () => {
    const rows: { accountId: string; amount: number }[] = [];
    for (const [k, v] of formData.entries()) if (k.startsWith("budget:")) rows.push({ accountId: id.parse(k.slice(7)), amount: paisa(v) });
    await saveBudgets(ctx, fyOf(fy), rows);
  });
  done(back);
}
