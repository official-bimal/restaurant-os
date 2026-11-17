import { db } from "@/server/db";
import { requireTenant } from "@/server/auth";
import { logout } from "@/app/login/actions";
import { PushToggle } from "@/components/push-toggle";
import { pushPublicKey } from "@/features/notifications/server/push";
import { subscribePushAction, unsubscribePushAction } from "@/app/(app)/notifications/push-actions";

/** A rider sees nothing but their own deliveries: no sidebar, no other pages. */
export default async function RiderLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant("delivery.ride");
  const [business, user] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { name: true } }),
    db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } }),
  ]);
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3">
        <span className="grid size-9 place-items-center rounded-xl bg-orange-500 text-sm font-bold text-white">R</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{business.name}</p>
          <p className="truncate text-xs text-stone-500">{user.name} · rider</p>
        </div>
        <form action={logout}>
          <button className="rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-100">Sign out</button>
        </form>
      </header>
      {pushPublicKey() && (
        <div className="mx-auto max-w-md px-4 pt-3">
          <PushToggle config={{ publicKey: pushPublicKey()!, subscribe: subscribePushAction, unsubscribe: unsubscribePushAction }} />
        </div>
      )}
      <main className="mx-auto max-w-md p-4">{children}</main>
    </div>
  );
}
