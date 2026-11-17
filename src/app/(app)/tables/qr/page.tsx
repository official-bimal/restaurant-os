import QRCode from "qrcode";
import { requireTenant } from "@/server/auth";
import { db } from "@/server/db";
import { getFloorAdmin } from "@/features/floor/server/service";

export const dynamic = "force-dynamic";

export default async function QrPostersPage() {
  const ctx = await requireTenant("floor.manage");
  const [areas, business] = await Promise.all([
    getFloorAdmin(ctx),
    db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { name: true } }),
  ]);
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const tables = areas.flatMap((a) => a.tables.map((t) => ({ ...t, area: a.name })));

  const posters = await Promise.all(
    tables.map(async (t) => ({
      id: t.id,
      label: t.label,
      area: t.area,
      svg: await QRCode.toString(`${base}/t/${t.publicToken}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
    })),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 print:hidden">
        <h1 className="text-xl font-semibold">QR codes</h1>
        <p className="text-sm text-stone-500">
          Print this page (Ctrl+P) and put one code on each table. They point to {base}.
        </p>
      </div>
      {posters.length === 0 && <p className="text-stone-500">Add tables first.</p>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2">
        {posters.map((p) => (
          <li key={p.id} className="break-inside-avoid rounded-2xl bg-white p-4 text-center border border-stone-200 shadow-sm print:ring-stone-400">
            <p className="text-sm text-stone-500">{business.name}</p>
            <p className="text-3xl font-bold">{p.label}</p>
            <div
              role="img"
              aria-label={`QR code for table ${p.label}`}
              className="mx-auto my-2 w-48 [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: p.svg }}
            />
            <p className="font-medium">Scan to order from your phone</p>
            <p className="text-xs text-stone-500">{p.area}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
