"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { DomainError } from "@/server/errors";
import {
  addSchedule,
  createMenuSet,
  deleteMenuSet,
  removeSchedule,
  setActiveMenuSet,
  setMenuSetItems,
} from "@/features/menu/server/menu-sets";

const BACK = "/menu/sets";
const done = () => {
  // The order screen and the guest menu both depend on the active set.
  revalidatePath("/", "layout");
  redirect(BACK);
};

export async function createSetAction(formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => createMenuSet(ctx, String(formData.get("name") ?? "")));
  done();
}

export async function deleteSetAction(id: string) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => deleteMenuSet(ctx, id));
  done();
}

export async function setItemsAction(id: string, formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => setMenuSetItems(ctx, id, formData.getAll("item").map(String)));
  done();
}

/** An empty value means "follow the schedule". */
export async function activateAction(formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  const id = String(formData.get("setId") ?? "");
  await guarded(BACK, () => setActiveMenuSet(ctx, id || null));
  done();
}

export async function addScheduleAction(formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  const days = formData.getAll("day").map((d) => Number(d));
  if (days.length === 0) {
    await guarded(BACK, async () => {
      throw new DomainError("Choose at least one day.");
    });
  }
  for (const dayOfWeek of days) {
    await guarded(BACK, () =>
      addSchedule(ctx, {
        menuSetId: String(formData.get("setId") ?? ""),
        dayOfWeek,
        start: String(formData.get("start") ?? ""),
        end: String(formData.get("end") ?? ""),
      }),
    );
  }
  done();
}

export async function removeScheduleAction(id: string) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => removeSchedule(ctx, id));
  done();
}
