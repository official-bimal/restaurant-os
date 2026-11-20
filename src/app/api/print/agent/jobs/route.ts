import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { businessForAgentKey } from "@/features/printing/server/settings";
import { collectJobs } from "@/features/printing/server/queue";

/**
 * The printer program asks "is there anything to print?" with its key (`Authorization: Bearer pk_...`). It gets the waiting
 * jobs, each with the printer bytes (base64 ESC/POS) and the same text as plain lines.
 *
 * `?printer=<id>` names the printer the program drives (the id is shown on the Printers page): it then gets only the jobs routed to
 * that printer, laid out for its paper, and the app notes that it is connected. Without it the program gets the jobs routed to no
 * printer in particular, which is how a single printer has always worked. Optional `?branch=<id>` limits it to one branch.
 */
export async function GET(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const businessId = await businessForAgentKey(header.startsWith("Bearer ") ? header.slice(7) : null);
  if (!businessId) return new NextResponse("Unauthorized", { status: 401 });
  const printerId = request.nextUrl.searchParams.get("printer") ?? undefined;
  if (printerId) {
    if (printerId.length > 60) return new NextResponse("Unknown printer", { status: 404 });
    // The printer must belong to the business the key belongs to.
    const printer = await db.printer.findFirst({ where: { id: printerId, businessId }, select: { id: true, branchId: true } });
    if (!printer) return new NextResponse("Unknown printer", { status: 404 });
    await db.printer.update({ where: { id: printer.id }, data: { lastSeenAt: new Date() } });
    const jobs = await collectJobs(businessId, { branchId: printer.branchId, printerId: printer.id });
    return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
  }
  const branch = request.nextUrl.searchParams.get("branch") ?? undefined;
  const jobs = await collectJobs(businessId, { branchId: branch && branch.length < 60 ? branch : undefined });
  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
