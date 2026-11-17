"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import {
  createBand,
  createZone,
  setBandActive,
  setRoadFactor,
  setVatOnDeliveryFee,
  setZoneActive,
  updateBand,
  updateZone,
} from "@/features/delivery/server/service";

const BACK = "/delivery";
const rupeesToPaisa = (v: FormDataEntryValue | null) => Math.round(Number(v || 0) * 100);
const done = () => {
  revalidatePath("/", "layout");
  redirect(BACK);
};

export async function createZoneAction(formData: FormData) {
  const ctx = await requireTenant("floor.manage");
  await guarded(BACK, () => createZone(ctx, { name: String(formData.get("name") ?? ""), fee: rupeesToPaisa(formData.get("fee")) }));
  done();
}

export async function updateZoneAction(id: string, formData: FormData) {
  const ctx = await requireTenant("floor.manage");
  await guarded(BACK, () => updateZone(ctx, id, { name: String(formData.get("name") ?? ""), fee: rupeesToPaisa(formData.get("fee")) }));
  done();
}

export async function setZoneActiveAction(id: string, active: boolean) {
  const ctx = await requireTenant("floor.manage");
  await guarded(BACK, () => setZoneActive(ctx, id, active));
  done();
}

export async function createBandAction(formData: FormData) {
  const ctx = await requireTenant("floor.manage");
  await guarded(BACK, () => createBand(ctx, { upToKm: Number(formData.get("upToKm") || 0), fee: rupeesToPaisa(formData.get("fee")) }));
  done();
}

export async function updateBandAction(id: string, formData: FormData) {
  const ctx = await requireTenant("floor.manage");
  await guarded(BACK, () => updateBand(ctx, id, { upToKm: Number(formData.get("upToKm") || 0), fee: rupeesToPaisa(formData.get("fee")) }));
  done();
}

export async function setBandActiveAction(id: string, active: boolean) {
  const ctx = await requireTenant("floor.manage");
  await guarded(BACK, () => setBandActive(ctx, id, active));
  done();
}

export async function setVatOnFeeAction(formData: FormData) {
  const ctx = await requireTenant("floor.manage");
  await guarded(BACK, () => setVatOnDeliveryFee(ctx, formData.get("vat") === "on"));
  done();
}

export async function setRoadFactorAction(formData: FormData) {
  const ctx = await requireTenant("floor.manage");
  await guarded(BACK, () => setRoadFactor(ctx, Math.round(Number(formData.get("pct") || 0))));
  done();
}
