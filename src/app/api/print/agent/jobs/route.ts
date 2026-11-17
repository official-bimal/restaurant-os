import { NextResponse, type NextRequest } from "next/server";
import { businessForAgentKey } from "@/features/printing/server/settings";
import { collectJobs } from "@/features/printing/server/queue";

/**
 * The printer program asks "is there anything to print?" with its key (`Authorization: Bearer pk_...`). It gets the waiting
 * jobs, each with the printer bytes (base64 ESC/POS) and the same text as plain lines. Optional `?branch=<id>` limits it to
 * one branch's printer. See the README ("Printers") for the program that sits next to a printer.
 */
export async function GET(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const businessId = await businessForAgentKey(header.startsWith("Bearer ") ? header.slice(7) : null);
  if (!businessId) return new NextResponse("Unauthorized", { status: 401 });
  const branch = request.nextUrl.searchParams.get("branch") ?? undefined;
  const jobs = await collectJobs(businessId, { branchId: branch && branch.length < 60 ? branch : undefined });
  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
