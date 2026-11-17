"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import {
  archiveAddOn,
  archiveGroup,
  createAddOn,
  createGroup,
  setAddOnStock,
  setGroupItems,
  updateAddOn,
  updateGroup,
} from "@/features/menu/server/addons";

const BACK = "/menu/extras";
const rupeesToPaisa = (v: FormDataEntryValue | null) => Math.round(Number(v || 0) * 100);
const done = () => {
  revalidatePath("/menu", "layout");
  redirect(BACK);
};

export async function createGroupAction(formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () =>
    createGroup(ctx, {
      name: String(formData.get("name") ?? ""),
      required: formData.get("required") === "on",
      multiple: formData.get("multiple") === "on",
    }),
  );
  done();
}

export async function updateGroupAction(id: string, formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () =>
    updateGroup(ctx, id, {
      name: String(formData.get("name") ?? ""),
      required: formData.get("required") === "on",
      multiple: formData.get("multiple") === "on",
    }),
  );
  done();
}

export async function archiveGroupAction(id: string) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => archiveGroup(ctx, id));
  done();
}

export async function createAddOnAction(groupId: string, formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => createAddOn(ctx, groupId, { name: String(formData.get("name") ?? ""), price: rupeesToPaisa(formData.get("price")) }));
  done();
}

export async function updateAddOnAction(id: string, formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => updateAddOn(ctx, id, { name: String(formData.get("name") ?? ""), price: rupeesToPaisa(formData.get("price")) }));
  done();
}

export async function archiveAddOnAction(id: string) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => archiveAddOn(ctx, id));
  done();
}

/** Fields are named stock_<stockItemId>; blank or 0 means the add-on does not use that item. */
export async function setAddOnStockAction(addOnId: string, formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  const lines: { stockItemId: string; quantity: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("stock_")) continue;
    const quantity = Math.floor(Number(value || 0));
    if (quantity > 0) lines.push({ stockItemId: key.slice("stock_".length), quantity });
  }
  await guarded(BACK, () => setAddOnStock(ctx, addOnId, lines));
  done();
}

export async function setGroupItemsAction(groupId: string, formData: FormData) {
  const ctx = await requireTenant("menu.manage");
  await guarded(BACK, () => setGroupItems(ctx, groupId, formData.getAll("item").map(String)));
  done();
}
