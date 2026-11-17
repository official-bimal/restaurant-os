import { NextResponse, type NextRequest } from "next/server";
import { getTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { isDocKind, renderDocument, type DocFormat } from "@/features/printing/server/render";

/**
 * A printable file for one document, for a signed-in person: `?kind=invoice|credit-note|kitchen&id=...&format=pdf|escpos|text`,
 * optionally `&w=<mm>&h=<mm>` to print on a paper size chosen at that moment (h=0 for "as long as needed").
 * The PDF opens in the browser; the printer file (ESC/POS) downloads.
 */
export async function GET(request: NextRequest) {
  const ctx = await getTenant();
  if (!ctx) return new NextResponse("Sign in first.", { status: 401 });
  const q = request.nextUrl.searchParams;
  const kind = q.get("kind") ?? "";
  const id = q.get("id") ?? "";
  const format = (q.get("format") ?? "pdf") as DocFormat;
  if (!isDocKind(kind) || !id || id.length > 60 || !["pdf", "escpos", "text"].includes(format)) return new NextResponse("Bad request.", { status: 400 });
  try {
    const out = await renderDocument(ctx, kind, id, format, { w: q.get("w") ?? undefined, h: q.get("h") ?? undefined });
    return new NextResponse(Buffer.from(out.bytes), {
      headers: {
        "Content-Type": out.type,
        "Content-Disposition": `${format === "escpos" ? "attachment" : "inline"}; filename="${out.file}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse(e.message, { status: 404 });
    throw e;
  }
}

export const dynamic = "force-dynamic";
