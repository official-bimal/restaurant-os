import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DomainError } from "@/server/errors";
import { businessForAgentKey } from "@/features/printing/server/settings";
import { finishJob } from "@/features/printing/server/queue";

/** The printer program reports how a job went: `{ "ok": true }` or `{ "ok": false, "error": "out of paper" }`. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/print/agent/jobs/[id]">) {
  const header = request.headers.get("authorization") ?? "";
  const businessId = await businessForAgentKey(header.startsWith("Bearer ") ? header.slice(7) : null);
  if (!businessId) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const body = z.object({ ok: z.boolean(), error: z.string().max(300).optional() }).safeParse(await request.json().catch(() => null));
  if (!body.success || id.length > 60) return new NextResponse("Bad request", { status: 400 });
  try {
    await finishJob(businessId, id, body.data.ok, body.data.error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof DomainError) return new NextResponse(e.message, { status: 404 });
    throw e;
  }
}

export const dynamic = "force-dynamic";
