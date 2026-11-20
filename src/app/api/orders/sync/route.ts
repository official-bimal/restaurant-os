import { NextResponse, type NextRequest } from "next/server";
import { getTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { offlineOrderSchema } from "@/features/orders/offline";
import { applyOfflineOrder } from "@/features/orders/server/offline-sync";

/** Receives one order that was taken while the phone was offline. Needs a normal staff session. */
export async function POST(request: NextRequest) {
  const ctx = await getTenant();
  if (!ctx) return NextResponse.json({ ok: false, retry: false, error: "Please sign in again, then send the saved orders." }, { status: 401 });
  if (!can(ctx, "order.create") || !can(ctx, "order.edit")) {
    return NextResponse.json({ ok: false, retry: false, error: "You do not have permission to take orders." }, { status: 403 });
  }
  const body = offlineOrderSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, retry: false, error: "That saved order could not be read." }, { status: 400 });
  try {
    return NextResponse.json(await applyOfflineOrder(ctx, body.data));
  } catch {
    // Anything unexpected is worth another try later: the key keeps a retry from making a second order.
    return NextResponse.json({ ok: false, retry: true, error: "The server had a problem. It will try again." }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
