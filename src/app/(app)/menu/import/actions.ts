"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { applyMenuImport, previewMenuImport, type ImportPreview } from "@/features/menu/server/csv";

export type PreviewResult = { ok: true; preview: ImportPreview } | { ok: false; error: string };
export type ApplyResult = { ok: true; added: number; updated: number; unchanged: number; skipped: { line: number; message: string }[] } | { ok: false; error: string };

export async function previewImportAction(text: string): Promise<PreviewResult> {
  const ctx = await requireTenant("menu.manage");
  try {
    return { ok: true, preview: await previewMenuImport(ctx, text) };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function applyImportAction(text: string): Promise<ApplyResult> {
  const ctx = await requireTenant("menu.manage");
  try {
    const r = await applyMenuImport(ctx, text);
    revalidatePath("/menu");
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
}
