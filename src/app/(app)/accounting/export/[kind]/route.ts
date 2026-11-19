import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { isValidDate } from "@/lib/business-day";
import { booksCsv, getPurchaseBook, getSalesBook } from "@/features/accounting/server/registers";

export const dynamic = "force-dynamic";

/** The sales or purchase book as a CSV file, for the accountant or the VAT return. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await requireTenant("books.view");
  const { kind } = await params;
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if ((kind !== "sales" && kind !== "purchase") || !isValidDate(from) || !isValidDate(to)) return new NextResponse("Not found", { status: 404 });
  try {
    const book = kind === "sales" ? await getSalesBook(ctx, from, to) : await getPurchaseBook(ctx, from, to);
    return new NextResponse("﻿" + booksCsv(book.rows, kind === "sales" ? "Buyer" : "Supplier"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${kind}-book-${from}-to-${to}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse(e.message, { status: 400 });
    throw e;
  }
}
