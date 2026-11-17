import { NextResponse, type NextRequest } from "next/server";
import { secretMatches } from "@/features/notifications/server/scheduled";
import { runOwnerChecks } from "@/features/owner/server/owner";

/**
 * Runs the owner checks now (new alerts, and the daily summary once its hour has passed). Call it with
 * `Authorization: Bearer <CRON_SECRET>` from any scheduler, instead of or as well as the built-in timer. Without CRON_SECRET
 * (16+ characters) it is off and answers 404. Safe to call as often as you like.
 */
async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) return new NextResponse("Not found", { status: 404 });
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!secretMatches(provided, expected)) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json({ results: await runOwnerChecks() });
}

export const GET = handle;
export const POST = handle;
export const dynamic = "force-dynamic";
