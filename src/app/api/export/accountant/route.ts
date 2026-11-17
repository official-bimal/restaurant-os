import { NextResponse, type NextRequest } from "next/server";
import { getTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { buildAccountantWorkbook } from "@/features/owner/server/export";

/** The accountant's Excel workbook for `?from=YYYY-MM-DD&to=YYYY-MM-DD`. Owner only. */
export async function GET(request: NextRequest) {
  const ctx = await getTenant();
  if (!ctx) return new NextResponse("Sign in first.", { status: 401 });
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  try {
    const bytes = await buildAccountantWorkbook(ctx, from, to);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="books-${from}-to-${to}.xlsx"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse(e.message, { status: e.message.includes("Only the owner") ? 403 : 400 });
    throw e;
  }
}

export const dynamic = "force-dynamic";
