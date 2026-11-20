import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { follow } from "@/features/display/server/service";

/**
 * The till tells a customer screen which order to show, with the bill options chosen so far. Signed-in staff who can take payment only.
 * `{ displayId, orderId: null }` sends the screen back to the welcome.
 */
export async function POST(request: NextRequest) {
  const ctx = await getTenant();
  if (!ctx) return new NextResponse("Sign in first.", { status: 401 });
  const body = z
    .object({ displayId: z.string().min(1).max(60), orderId: z.string().min(1).max(60).nullable(), options: z.unknown().optional(), showQr: z.boolean().optional() })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return new NextResponse("Bad request", { status: 400 });
  try {
    await follow(ctx, body.data);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse(e.message, { status: 400 });
    throw e;
  }
}

export const dynamic = "force-dynamic";
