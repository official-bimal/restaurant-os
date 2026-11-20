import { NextResponse, type NextRequest } from "next/server";
import { baseUrlFrom } from "@/features/payments/server/base-url";
import { screenState } from "@/features/display/server/service";

/** What a customer screen shows right now. The secret link is the credential; nothing here needs a login. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/display/[token]">) {
  const { token } = await ctx.params;
  const state = await screenState(token, baseUrlFrom(request.headers));
  if (!state) return new NextResponse("This screen link is not valid any more.", { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

export const dynamic = "force-dynamic";
