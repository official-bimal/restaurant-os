import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { syncOfflineBill } from "@/features/offline/server/sync";

const discount = z.union([
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("percent"), bps: z.number().int() }),
  z.object({ kind: z.literal("amount"), amount: z.number().int() }),
]);

const schema = z.object({
  snapshot: z.string().max(2_000_000),
  sig: z.string().max(200),
  bill: z.object({
    key: z.string().min(8).max(100),
    deviceId: z.string().min(16).max(64),
    type: z.enum(["DINE_IN", "TAKEAWAY"]),
    tableId: z.string().max(60).nullable(),
    billedAt: z.string().max(40),
    invoiceNumber: z.number().int().min(1).max(2_000_000_000),
    items: z.array(z.object({ menuItemId: z.string().min(1).max(60), quantity: z.number().int(), note: z.string().max(300).optional() })).min(1).max(60),
    discount,
    payments: z.array(z.object({ method: z.enum(["CASH", "QR", "CARD"]), amount: z.number().int() })).min(1).max(6),
    expectedTotal: z.number().int(),
    customerPhone: z.string().max(30).optional(),
  }),
});

/**
 * Receives one bill made on a phone with no connection. The answer says whether it was recorded; a bill that cannot be
 * accepted comes back with a code and a reason and is never half recorded, so the phone keeps it and shows it as needing attention.
 */
export async function POST(request: NextRequest) {
  const ctx = await getTenant();
  if (!ctx) return NextResponse.json({ ok: false, code: "AUTH", error: "Please sign in again, then send the saved bills.", retry: true }, { status: 401 });
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, code: "INVALID", error: "That saved bill could not be read.", retry: false }, { status: 400 });
  try {
    const res = await syncOfflineBill(ctx, body.data);
    return NextResponse.json({ ...res, retry: false });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ ok: false, code: "INVALID", error: e.message, retry: false }, { status: 403 });
    // Anything unexpected is worth another try later: the bill's key makes a retry safe.
    return NextResponse.json({ ok: false, code: "SERVER", error: "The server had a problem. It will try again.", retry: true }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
