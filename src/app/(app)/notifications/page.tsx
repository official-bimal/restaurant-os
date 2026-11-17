import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { listNotifications, type AppNotification } from "@/features/notifications/server/service";
import { markAllReadAction, markReadAction } from "./actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { Icon } from "@/components/icons";

export const dynamic = "force-dynamic";

const LOOK: Record<AppNotification["kind"], { icon: string; tile: string }> = {
  CLOCK: { icon: "clock", tile: "bg-slate-100 text-slate-600" },
  GUEST_ORDER: { icon: "orders", tile: "bg-blue-100 text-blue-600" },
  GUEST_REQUEST: { icon: "bell", tile: "bg-orange-100 text-orange-600" },
  LOW_STOCK: { icon: "stock", tile: "bg-amber-100 text-amber-600" },
  LOW_RATING: { icon: "feedback", tile: "bg-rose-100 text-rose-600" },
  STALE_BILL: { icon: "bills", tile: "bg-violet-100 text-violet-600" },
  STOCK_ARRIVING: { icon: "truck", tile: "bg-sky-100 text-sky-600" },
};
const BORDER = { alert: "border-l-red-500", warn: "border-l-amber-400", info: "border-l-stone-300" } as const;

function ago(d: Date) {
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default async function NotificationsPage() {
  const ctx = await requireTenant();
  const items = await listNotifications(ctx);
  const unread = items.filter((n) => !n.read);
  const urgent = unread.filter((n) => n.level === "alert").length;

  return (
    <div className="space-y-6">
      <AutoRefresh everyMs={10000} />
      <div>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-sm text-stone-500">
          {items.length === 0
            ? "Nothing needs you right now."
            : `${unread.length} unread of ${items.length}${urgent ? `, ${urgent} urgent` : ""}. Each one clears itself when it is dealt with; marking it read only dims it for you.`}
        </p>
        {unread.length > 0 && (
          <form action={markAllReadAction} className="mt-2">
            <button className="min-h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm hover:bg-stone-50">Mark all as read</button>
          </form>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card grid place-items-center gap-2 p-12 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-emerald-100 text-emerald-600">
            <Icon name="check" className="size-7" />
          </span>
          <p className="font-semibold">All clear</p>
          <p className="text-sm text-stone-500">New guest orders, low stock and low ratings show up here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((n) => {
            const look = LOOK[n.kind];
            return (
              <li key={n.id}>
                <div className={`card flex items-center gap-4 border-l-4 p-4 ${BORDER[n.level]} ${n.read ? "opacity-60" : ""}`}>
                  <Link href={n.href} className="flex min-w-0 flex-1 items-center gap-4 hover:opacity-80">
                  <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${look.tile}`}>
                    <Icon name={look.icon} className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{n.title}</p>
                    <p className="truncate text-sm text-stone-500">{n.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs text-stone-400">{ago(n.at)}</span>
                  </Link>
                  {!n.read && (
                    <form action={markReadAction.bind(null, n.id)}>
                      <button className="min-h-9 shrink-0 rounded-lg border border-stone-300 px-3 text-xs hover:bg-stone-50">Mark read</button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
