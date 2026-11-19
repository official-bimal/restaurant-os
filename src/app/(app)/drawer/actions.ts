"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { DomainError } from "@/server/errors";
import { addMovement, closeShift, openShift } from "@/features/drawer/server/service";

function paisa(raw: FormDataEntryValue | null): number {
  const t = String(raw ?? "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new DomainError("Enter the amount as a number, like 1250 or 1250.50.");
  return Math.round(Number(t) * 100);
}

function done(): never {
  revalidatePath("/drawer");
  redirect("/drawer");
}

export async function openDrawerAction(formData: FormData) {
  const ctx = await requireTenant();
  await guarded("/drawer", () => openShift(ctx, paisa(formData.get("float"))));
  done();
}

export async function moveCashAction(formData: FormData) {
  const ctx = await requireTenant();
  await guarded("/drawer", () => addMovement(ctx, { kind: String(formData.get("kind") ?? ""), amount: paisa(formData.get("amount")), reason: String(formData.get("reason") ?? "") }));
  done();
}

export async function closeDrawerAction(formData: FormData) {
  const ctx = await requireTenant();
  await guarded("/drawer", () => closeShift(ctx, { countedCash: paisa(formData.get("counted")), note: String(formData.get("note") ?? "") }));
  done();
}
