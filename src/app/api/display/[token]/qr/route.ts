import { NextResponse } from "next/server";
import { screenQr } from "@/features/display/server/service";

/** The fixed payment QR picture (a Fonepay or bank sticker) for a valid screen link. */
export async function GET(_req: Request, ctx: RouteContext<"/api/display/[token]/qr">) {
  const { token } = await ctx.params;
  const qr = await screenQr(token);
  if (!qr) return new NextResponse("No QR.", { status: 404 });
  return new NextResponse(Buffer.from(qr.data), { headers: { "Content-Type": qr.contentType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}

export const dynamic = "force-dynamic";
