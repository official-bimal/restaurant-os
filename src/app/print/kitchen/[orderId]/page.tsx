import { notFound } from "next/navigation";
import { requireTenant } from "@/server/auth";
import { DomainError } from "@/server/errors";
import { getKitchenSlip } from "@/features/printing/server/documents";
import { paperWidth } from "@/features/printing/receipt";
import { PrintShell, Rule } from "@/components/print-shell";

export const dynamic = "force-dynamic";

const TYPE: Record<string, string> = { DINE_IN: "Dine in", TAKEAWAY: "Takeaway", DELIVERY: "Delivery", QUICK_BILL: "Quick bill" };

export default async function PrintKitchen({ params, searchParams }: PageProps<"/print/kitchen/[orderId]">) {
  const ctx = await requireTenant();
  const { orderId } = await params;
  const q = await searchParams;
  let s;
  try {
    s = await getKitchenSlip(ctx, orderId);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const time = s.createdAt.toLocaleTimeString("en-GB", { timeZone: s.timezone, hour: "2-digit", minute: "2-digit" });
  return (
    <PrintShell width={paperWidth(q.w)} auto={q.auto === "1"}>
      <div className="text-center">
        <div className="text-[16px] font-bold">
          {s.table ?? TYPE[s.type] ?? s.type} · #{s.number}
        </div>
        <div>
          {s.branch} · {time}
        </div>
      </div>
      {s.note && <div className="mt-1 font-bold">NOTE: {s.note}</div>}
      {s.groups.length === 0 && <p className="mt-2">Nothing to cook on this order.</p>}
      {s.groups.map((g) => (
        <div key={g.station}>
          <Rule />
          <div className="font-bold uppercase">{g.station}</div>
          {g.items.map((i) => (
            <div key={i.id} className="mb-1 text-[14px]">
              <span className="font-bold">{i.quantity} x</span> {i.name}
              {i.addOns.length > 0 && <div className="pl-4 text-[12px]">+ {i.addOns.join(", ")}</div>}
              {i.note && <div className="pl-4 text-[12px]">** {i.note} **</div>}
            </div>
          ))}
        </div>
      ))}
    </PrintShell>
  );
}
