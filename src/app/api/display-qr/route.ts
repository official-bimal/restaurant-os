import { NextResponse } from "next/server";
import { getTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { previewPaymentQr } from "@/features/display/server/service";

/** The saved payment QR, for the setup page. Signed-in staff who manage the customer display only. */
export async function GET() {
  const ctx = await getTenant();
  if (!ctx) return new NextResponse("Sign in first.", { status: 401 });
  try {
    const qr = await previewPaymentQr(ctx);
    if (!qr) return new NextResponse("No QR.", { status: 404 });
    return new NextResponse(Buffer.from(qr.data), { headers: { "Content-Type": qr.contentType, "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse(e.message, { status: 403 });
    throw e;
  }
}

export const dynamic = "force-dynamic";
