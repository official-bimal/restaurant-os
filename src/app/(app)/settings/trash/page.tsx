import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { listTrash } from "@/features/business/server/trash";
import { TRASH_DAYS } from "@/features/business/trash";
import { purgeAction, restoreAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function TrashPage({ searchParams }: PageProps<"/settings/trash">) {
  const ctx = await requireTenant("menu.manage");
  const sp = await searchParams;
  const items = await listTrash(ctx);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-sm text-stone-500 hover:underline">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold">Trash</h1>
      </div>
      <p className="text-sm text-stone-600">Dishes you delete wait here for {TRASH_DAYS} days. Put one back and it returns with its price, category and recipe. After that it is gone for good.</p>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}
      {sp.restored === "1" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Put back on the menu.</p>}
      {items.length === 0 ? (
        <p className="card p-5 text-stone-600">The Trash is empty.</p>
      ) : (
        <ul className="card divide-y divide-stone-100">
          {items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 p-4">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t.label}</span>
                <span className="block text-xs text-stone-500">
                  Deleted {t.deletedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kathmandu" })} by {t.by} · {t.daysLeft} days left
                </span>
              </span>
              <form action={restoreAction.bind(null, t.id)}>
                <button className="min-h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white">Put back</button>
              </form>
              <form action={purgeAction.bind(null, t.id)}>
                <button className="min-h-10 px-2 text-sm text-red-700 hover:underline">Delete for good</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
