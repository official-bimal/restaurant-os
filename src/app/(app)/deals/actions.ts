"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { DomainError } from "@/server/errors";
import { deleteDeal, saveDeal, setDealActive } from "@/features/billing/server/deals";

const id = z.string().min(1).max(60);

function paisa(raw: FormDataEntryValue | null): number {
  const t = String(raw ?? "").replace(/,/g, "").trim();
  if (!t) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new DomainError("Enter amounts as numbers, like 250 or 250.50.");
  return Math.round(Number(t) * 100);
}

function minutes(raw: FormDataEntryValue | null): number | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) throw new DomainError("Choose valid times.");
  return Number(m[1]) * 60 + Number(m[2]);
}

function done(): never {
  revalidatePath("/deals");
  redirect("/deals");
}

export async function saveDealAction(formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  await guarded("/deals", async () => {
    const items: { menuItemId: string | null; categoryId: string | null; quantity: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const v = String(formData.get(`item${i}`) ?? "");
      if (!v) continue;
      const quantity = Math.floor(Number(formData.get(`qty${i}`) || 1)) || 1;
      if (v.startsWith("c:")) items.push({ menuItemId: null, categoryId: id.parse(v.slice(2)), quantity });
      else if (v.startsWith("m:")) items.push({ menuItemId: id.parse(v.slice(2)), categoryId: null, quantity });
    }
    const pct = Number(String(formData.get("percent") ?? "").trim() || 0);
    await saveDeal(ctx, {
      name: String(formData.get("name") ?? ""),
      kind: String(formData.get("kind") ?? ""),
      days: formData.getAll("day").map((d) => Number(d)),
      startMinute: minutes(formData.get("start")),
      endMinute: minutes(formData.get("end")),
      percentBps: Math.round(pct * 100),
      comboPrice: paisa(formData.get("comboPrice")),
      branchId: String(formData.get("branchId") ?? "") || null,
      items,
    });
  });
  done();
}

export async function toggleDealAction(dealId: string, active: boolean) {
  const ctx = await requireTenant("menu.manage");
  await guarded("/deals", () => setDealActive(ctx, id.parse(dealId), active));
  done();
}

export async function deleteDealAction(dealId: string) {
  const ctx = await requireTenant("menu.manage");
  await guarded("/deals", () => deleteDeal(ctx, id.parse(dealId)));
  done();
}
