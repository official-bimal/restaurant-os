import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { buildExport, EXPORT_KINDS } from "@/features/accounting/server/exports";

export const dynamic = "force-dynamic";

/** One book as a CSV file for the accountant or the VAT return. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await requireTenant("books.view");
  const { kind } = await params;
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return new NextResponse("Not found", { status: 404 });
  const q = req.nextUrl.searchParams;
  try {
    const { filename, csv } = await buildExport(ctx, kind, { from: q.get("from") ?? "", to: q.get("to") ?? "", account: q.get("account") ?? undefined });
    return new NextResponse("﻿" + csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "cache-control": "no-store" },
    });
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse(e.message, { status: 400 });
    throw e;
  }
}
