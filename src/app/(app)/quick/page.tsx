import { requireTenant } from "@/server/auth";
import { listMenu, listOpenOrders, listTables } from "@/features/orders/server/service";
import { QuickOrder } from "./quick-order";

export const dynamic = "force-dynamic";

/**
 * Order taking that keeps working when the Wi-Fi drops. Opened while online, it saves the menu and tables on the phone;
 * orders typed while offline wait there and are sent as soon as the connection is back.
 */
export default async function QuickPage() {
  const ctx = await requireTenant("order.create");
  const [menu, tables, open] = await Promise.all([listMenu(ctx), listTables(ctx), listOpenOrders(ctx)]);
  const busy = new Set(open.map((o) => o.tableId).filter(Boolean));
  return (
    <QuickOrder
      branchId={ctx.branchId}
      menu={menu
        .filter((c) => c.items.length > 0)
        .map((c) => ({ id: c.id, name: c.name, items: c.items.map((i) => ({ id: i.id, name: i.name, price: i.price })) }))}
      tables={tables.map((t) => ({ id: t.id, label: `${t.area.name} · ${t.label}`, busy: busy.has(t.id) }))}
    />
  );
}
