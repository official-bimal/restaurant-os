"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { addPrinter, deletePrinter, queueTest, saveRoutes, updatePrinter } from "@/features/printing/server/printers";
import { saveSlipFields } from "@/features/printing/server/settings";
import { fieldsFromForm } from "@/features/printing/slip-fields";
import { NO_STATION, ROUTE_KINDS, type RouteInput } from "@/features/printing/routing";

const PRINTERS = "/printing/printers";
const FIELDS = "/printing/fields";
const done = (to: string, note: string) => redirect(`${to}?note=${encodeURIComponent(note)}`);

export async function addPrinterAction(formData: FormData) {
  const ctx = await requireTenant("print.manage");
  await guarded(PRINTERS, () => addPrinter(ctx, { name: String(formData.get("name") ?? ""), paperWidthMm: formData.get("paperWidthMm") }));
  revalidatePath(PRINTERS);
  done(PRINTERS, "Printer added. Set where slips go below, then connect its program.");
}

export async function updatePrinterAction(id: string, formData: FormData) {
  const ctx = await requireTenant("print.manage");
  await guarded(PRINTERS, () => updatePrinter(ctx, id, { name: String(formData.get("name") ?? ""), paperWidthMm: formData.get("paperWidthMm") }));
  revalidatePath(PRINTERS);
  done(PRINTERS, "Saved.");
}

export async function deletePrinterAction(id: string) {
  const ctx = await requireTenant("print.manage");
  await guarded(PRINTERS, () => deletePrinter(ctx, id));
  revalidatePath(PRINTERS);
  done(PRINTERS, "Printer removed. Its routes and waiting jobs were removed too.");
}

/** Reads the routing form: kitchen default and per-station choices, bills and credit notes. */
export async function saveRoutesAction(formData: FormData) {
  const ctx = await requireTenant("print.manage");
  const pick = (name: string) => String(formData.get(name) ?? "") || null;
  const input: RouteInput[] = [
    { kind: "KITCHEN", stationKey: NO_STATION, printerId: pick("route.KITCHEN") },
    { kind: "RECEIPT", stationKey: NO_STATION, printerId: pick("route.RECEIPT") },
    { kind: "CREDIT_NOTE", stationKey: NO_STATION, printerId: pick("route.CREDIT_NOTE") },
  ];
  for (const [name, value] of formData.entries()) {
    if (typeof value === "string" && name.startsWith("station.") && value) input.push({ kind: "KITCHEN", stationKey: name.slice("station.".length), printerId: value });
  }
  void ROUTE_KINDS;
  await guarded(PRINTERS, () => saveRoutes(ctx, input));
  revalidatePath(PRINTERS);
  done(PRINTERS, "Routing saved.");
}

export async function testPrinterAction(id: string) {
  const ctx = await requireTenant("print.manage");
  await guarded(PRINTERS, () => queueTest(ctx, id));
  revalidatePath(PRINTERS);
  done(PRINTERS, "Test page queued. It prints when that printer's program next checks in.");
}

export async function testAllAction() {
  const ctx = await requireTenant("print.manage");
  await guarded(PRINTERS, () => queueTest(ctx));
  revalidatePath(PRINTERS);
  done(PRINTERS, "Test pages queued for every printer in this branch.");
}

export async function saveFieldsAction(formData: FormData) {
  const ctx = await requireTenant("print.manage");
  await guarded(FIELDS, () => saveSlipFields(ctx, fieldsFromForm((name) => formData.get(name) === "on")));
  revalidatePath("/printing", "layout");
  done(FIELDS, "Saved. New slips use these choices.");
}
