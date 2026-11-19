import { NextResponse, type NextRequest } from "next/server";
import { handleEsewaReturn } from "@/features/payments/server/service";

export const dynamic = "force-dynamic";

/** eSewa sends the customer here after paying, with signed `data`. Nothing in it is trusted until the signature and eSewa's status service agree. */
export async function GET(req: NextRequest) {
  const data = req.nextUrl.searchParams.get("data") ?? "";
  const r = data.length > 0 && data.length < 4_000 ? await handleEsewaReturn(data) : null;
  return NextResponse.redirect(new URL(r ? `/pay/${r.token}/result` : "/", req.url), 303);
}
