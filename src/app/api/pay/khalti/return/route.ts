import { NextResponse, type NextRequest } from "next/server";
import { handleKhaltiReturn } from "@/features/payments/server/service";

export const dynamic = "force-dynamic";

/** Khalti sends the customer here after paying. The query Khalti adds is ignored: Khalti is asked directly. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const r = await handleKhaltiReturn(token);
  return NextResponse.redirect(new URL(r ? `/pay/${r.token}/result` : "/", req.url), 303);
}
