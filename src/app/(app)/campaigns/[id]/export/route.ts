import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { exportQueued } from "@/features/campaigns/server/service";

/** A cell that starts with = + - or @ would be run as a formula by a spreadsheet. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(_req: Request, ctx: RouteContext<"/campaigns/[id]/export">) {
  const tenant = await requireTenant("campaign.manage");
  const { id } = await ctx.params;
  try {
    const { campaignName, rows } = await exportQueued(tenant, id);
    const csv = ["Name,Phone,Message", ...rows.map((r) => [r.name, r.phone, r.text].map(cell).join(","))].join("\r\n") + "\r\n";
    const file = campaignName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "campaign";
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file}-messages.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof DomainError) return new Response(e.message, { status: 404 });
    throw e;
  }
}
