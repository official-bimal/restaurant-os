import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/** eSewa sends the customer here when they cancel or the payment fails. The attempt stays open until it is checked or expires, so nothing is marked paid. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  return NextResponse.redirect(new URL(/^[A-Za-z0-9_-]{16,40}$/.test(token) ? `/pay/${token}/result` : "/", req.url), 303);
}
