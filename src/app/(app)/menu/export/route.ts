import { NextResponse } from "next/server";
import { requireTenant } from "@/server/auth";
import { exportMenuCsv } from "@/features/menu/server/csv";

export const dynamic = "force-dynamic";

/** The whole menu as a CSV file. */
export async function GET() {
  const ctx = await requireTenant("menu.manage");
  const csv = await exportMenuCsv(ctx);
  return new NextResponse("﻿" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="menu.csv"', "cache-control": "no-store" } });
}
