import { NextResponse } from "next/server";
import { screenLogo } from "@/features/display/server/service";

/** The business logo for a valid screen link. */
export async function GET(_req: Request, ctx: RouteContext<"/api/display/[token]/logo">) {
  const { token } = await ctx.params;
  const logo = await screenLogo(token);
  if (!logo) return new NextResponse("No logo.", { status: 404 });
  return new NextResponse(Buffer.from(logo.data), { headers: { "Content-Type": logo.contentType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}

export const dynamic = "force-dynamic";
