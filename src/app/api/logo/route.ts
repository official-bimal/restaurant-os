import { NextResponse } from "next/server";
import { getTenant } from "@/server/auth";
import { getLogo } from "@/features/business/server/profile";

/** The business logo, for signed-in staff only. */
export async function GET() {
  const ctx = await getTenant();
  if (!ctx) return new NextResponse("Sign in first.", { status: 401 });
  const logo = await getLogo(ctx);
  if (!logo) return new NextResponse("No logo.", { status: 404 });
  return new NextResponse(Buffer.from(logo.data), {
    headers: { "Content-Type": logo.contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}

export const dynamic = "force-dynamic";
