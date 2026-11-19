import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { getFloorAdmin } from "@/features/floor/server/service";
import { PlanEditor } from "./plan-editor";

export const dynamic = "force-dynamic";

export default async function FloorLayoutPage() {
  const ctx = await requireTenant("floor.manage");
  const areas = await getFloorAdmin(ctx);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/tables" className="text-sm text-stone-500 hover:underline">
          ← Tables
        </Link>
        <h1 className="text-xl font-semibold">Arrange the floor</h1>
      </div>
      <p className="text-sm text-stone-600">
        Drag each table to where it really stands, then save. Waiters see this plan on the Orders page instead of rows of tables, so they can find a table by where it is. On a phone, touch and drag; with a
        keyboard, focus a table and use the arrow keys. An area you never arrange stays in rows.
      </p>
      <PlanEditor areas={areas.map((a) => ({ id: a.id, name: a.name, tables: a.tables.map((t) => ({ id: t.id, label: t.label, capacity: t.capacity, posX: t.posX, posY: t.posY })) }))} />
    </div>
  );
}
