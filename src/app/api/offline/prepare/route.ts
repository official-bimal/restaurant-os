import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { makeSnapshot } from "@/features/offline/server/snapshot";
import { prepareDeviceBlocks } from "@/features/offline/server/blocks";
import { getPrintConfig } from "@/features/printing/server/settings";

/**
 * A phone that is online asks to be made ready for going offline: it gets a signed snapshot of the menu, prices, tax settings
 * and tables, and (if the person may take payments) a block of invoice numbers to use while it has no connection. Calling it
 * again refreshes the snapshot and tops up the numbers only when they are running low.
 */
export async function POST(request: NextRequest) {
  const ctx = await getTenant();
  if (!ctx) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = z.object({ deviceId: z.string().min(16).max(64) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  try {
    const snap = await makeSnapshot(ctx);
    const canBill = can(ctx, "bill.checkout");
    const numbers = canBill ? await prepareDeviceBlocks(ctx, body.data.deviceId) : { blocks: [], used: [] };
    // The receipt layout comes along so a bill can be printed on the phone with no connection.
    const print = await getPrintConfig(ctx.businessId);
    return NextResponse.json({ ...snap, canBill, print, blocks: numbers.blocks, used: numbers.used }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export const dynamic = "force-dynamic";
