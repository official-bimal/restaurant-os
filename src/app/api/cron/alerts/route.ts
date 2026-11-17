import { NextResponse, type NextRequest } from "next/server";
import { runScheduledAlerts, secretMatches } from "@/features/notifications/server/scheduled";

/**
 * Scheduled alert check (bills left open, stock still low). Call it with `Authorization: Bearer <CRON_SECRET>`.
 * Without CRON_SECRET configured (16+ characters) it is switched off and answers 404, so it cannot be probed.
 */
async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) return new NextResponse("Not found", { status: 404 });
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!secretMatches(provided, expected)) return new NextResponse("Unauthorized", { status: 401 });
  const result = await runScheduledAlerts();
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
export const dynamic = "force-dynamic";
