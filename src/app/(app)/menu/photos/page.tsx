import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { db } from "@/server/db";
import { BulkPhotos } from "./bulk-photos";

export const dynamic = "force-dynamic";

export default async function BulkPhotosPage() {
  const ctx = await requireTenant("menu.manage");
  const items = await db.menuItem.findMany({
    where: { businessId: ctx.businessId, available: true },
    select: { id: true, name: true, image: { select: { id: true } } },
    orderBy: { name: "asc" },
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/menu" className="text-sm text-stone-500 hover:underline">
          ← Menu
        </Link>
        <h1 className="text-xl font-semibold">Dish photos</h1>
      </div>
      <p className="text-sm text-stone-600">
        {items.filter((i) => i.image).length} of {items.length} dishes have a photo. Choose several photos at once: each is matched to a dish by its file name (for example
        &quot;Cafe Latte.jpg&quot;). Check the matches, fix any that are wrong, and upload. Photos are shrunk on your device first, so big phone photos are fine. A new photo replaces the old one.
      </p>
      <BulkPhotos dishes={items.map((i) => ({ id: i.id, name: i.name }))} withPhoto={items.filter((i) => i.image).map((i) => i.id)} />
    </div>
  );
}
