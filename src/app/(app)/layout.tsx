import { unseenAlertCount } from "@/features/owner/server/owner";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { requireTenant } from "@/server/auth";
import { logout } from "@/app/login/actions";
import { can } from "@/server/permissions";
import { inboxCount } from "@/features/guest/server/service";
import { onlineInboxCount } from "@/features/online/server/service";
import { unresolvedCount } from "@/features/feedback/server/service";
import { lowStockCount } from "@/features/stock/server/service";
import { listMyBranches } from "@/features/branches/server/service";
import { listNotifications } from "@/features/notifications/server/service";
import { switchBranchAction } from "./branches/actions";
import { AppShell } from "@/components/app-shell";
import { NavLinks, type NavGroup } from "@/components/nav-links";
import { BranchSwitcher } from "@/components/branch-switcher";
import { Icon } from "@/components/icons";
import { NotificationWatcher } from "@/components/notification-watcher";
import { ClockWidget } from "@/components/clock-widget";
import { myClock } from "@/features/payroll/server/time";
import { pushPublicKey } from "@/features/notifications/server/push";
import { subscribePushAction, unsubscribePushAction } from "./notifications/push-actions";

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  WAITER: "Waiter",
  KITCHEN: "Kitchen",
  RIDER: "Rider",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireTenant();
  // A rider has their own page and sees nothing else.
  if (ctx.role === "RIDER") redirect("/deliveries");
  const [business, user, waiting, lowRatings, lowStock, myBranches, notifications, clock, ownerAlerts, onlineWaiting] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: ctx.businessId } }),
    db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } }),
    inboxCount(ctx),
    unresolvedCount(ctx),
    lowStockCount(ctx),
    listMyBranches(ctx),
    listNotifications(ctx),
    myClock(ctx),
    unseenAlertCount(ctx),
    onlineInboxCount(ctx),
  ]);

  // The badge and the chime follow what this person has not read yet.
  const unreadNotifications = notifications.filter((n) => !n.read);
  const urgent = unreadNotifications.filter((n) => n.level === "alert").map((n) => ({ id: n.id, title: n.title }));

  const groups: NavGroup[] = [
    {
      label: "Service",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "dashboard", tone: "teal" as const },
        { href: "/notifications", label: "Notifications", icon: "bell", tone: "rose" as const, badge: unreadNotifications.length, badgeTone: "alert" as const },
        { href: "/orders", label: "Orders", icon: "orders", tone: "blue" as const, badge: waiting },
        ...(can(ctx.role, "order.edit") ? [{ href: "/online", label: "Online orders", icon: "orders", tone: "teal" as const, badge: onlineWaiting, badgeTone: "alert" as const }] : []),
        ...(can(ctx.role, "order.create") && can(ctx.role, "order.edit") ? [{ href: "/quick", label: "Quick order", icon: "orders", tone: "teal" as const }] : []),
        { href: "/kitchen", label: "Kitchen", icon: "kitchen", tone: "orange" as const },
        ...(can(ctx.role, "order.edit") ? [{ href: "/dispatch", label: "Dispatch", icon: "truck", tone: "blue" as const }] : []),
        ...(can(ctx.role, "floor.manage") ? [{ href: "/tables", label: "Tables", icon: "tables", tone: "violet" as const }] : []),
        ...(can(ctx.role, "floor.manage") ? [{ href: "/delivery", label: "Delivery pricing", icon: "truck", tone: "orange" as const }] : []),
      ],
    },
    {
      label: "Catalogue",
      items: [
        ...(can(ctx.role, "menu.manage") ? [{ href: "/menu", label: "Menu", icon: "menu", tone: "rose" as const }] : []),
        ...(can(ctx.role, "stock.view") ? [{ href: "/stock", label: "Stock", icon: "stock", tone: "amber" as const, badge: lowStock }] : []),
      ],
    },
    {
      label: "Guests",
      items: [
        ...(can(ctx.role, "customer.manage") ? [{ href: "/customers", label: "Customers", icon: "customers", tone: "pink" as const }] : []),
        ...(can(ctx.role, "campaign.manage") ? [{ href: "/campaigns", label: "Campaigns", icon: "campaigns", tone: "violet" as const }] : []),
        ...(can(ctx.role, "feedback.view")
          ? [{ href: "/feedback", label: "Feedback", icon: "feedback", tone: "amber" as const, badge: lowRatings, badgeTone: "alert" as const }]
          : []),
      ],
    },
    {
      label: "Money",
      items: [
        ...(can(ctx.role, "report.view") ? [{ href: "/reports", label: "Reports", icon: "reports", tone: "emerald" as const }] : []),
        ...(can(ctx.role, "bills.view") ? [{ href: "/bills", label: "Bills", icon: "bills", tone: "emerald" as const }] : []),
      ],
    },
    {
      label: "Admin",
      items: [
        ...(can(ctx.role, "branch.manage") ? [{ href: "/branches", label: "Branches", icon: "branches", tone: "slate" as const }] : []),
        ...(can(ctx.role, "staff.manage") ? [{ href: "/staff", label: "Staff", icon: "staff", tone: "slate" as const }] : []),
        { href: "/time", label: "Time", icon: "clock", tone: "slate" as const },
        ...(can(ctx.role, "time.manage") ? [{ href: "/attendance", label: "Attendance", icon: "staff", tone: "teal" as const }] : []),
        ...(can(ctx.role, "owner.control") ? [{ href: "/owner", label: "Owner control", icon: "reports", tone: "rose" as const, badge: ownerAlerts, badgeTone: "alert" as const }] : []),
        ...(can(ctx.role, "owner.control") ? [{ href: "/customer-os", label: "Customer OS", icon: "staff", tone: "teal" as const }] : []),
        ...(can(ctx.role, "print.manage") ? [{ href: "/printing", label: "Printing", icon: "bills", tone: "slate" as const }] : []),
        ...(can(ctx.role, "payroll.manage") ? [{ href: "/payroll", label: "Payroll", icon: "bills", tone: "emerald" as const }] : []),
      ],
    },
  ].filter((g) => g.items.length > 0);

  // The few screens each role uses all day sit in the phone's bottom bar; everything else is under "More".
  const PREFERRED: Record<string, string[]> = {
    OWNER: ["/dashboard", "/orders", "/kitchen", "/notifications"],
    MANAGER: ["/dashboard", "/orders", "/kitchen", "/notifications"],
    CASHIER: ["/orders", "/quick", "/kitchen", "/notifications"],
    WAITER: ["/orders", "/quick", "/kitchen", "/notifications"],
    KITCHEN: ["/kitchen", "/notifications", "/stock"],
  };
  const everyItem = groups.flatMap((g) => g.items);
  const tabs = (PREFERRED[ctx.role] ?? PREFERRED.WAITER!).flatMap((href) => everyItem.filter((i) => i.href === href)).slice(0, 4);

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white">R</span>
      <span className="text-base font-semibold tracking-tight">Restaurant OS</span>
    </Link>
  );

  const top = (
    <div className="space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-3">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-sm font-bold text-brand-700 ring-1 ring-stone-200">
          {initials(business.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{business.name}</p>
          <p className="truncate text-xs text-stone-500">{myBranches.length === 1 ? myBranches[0]!.name : `${myBranches.length} branches`}</p>
        </div>
      </div>
      {myBranches.length > 1 && <BranchSwitcher action={switchBranchAction} branches={myBranches} current={ctx.branchId} />}
    </div>
  );

  const bottom = (
    <div className="space-y-2 border-t border-stone-200 pt-3">
      <ClockWidget since={clock.since ? clock.since.toISOString() : null} workedTodayMinutes={clock.workedTodayMinutes} timeZone={business.timezone} askLocation={business.clockRequireLocation} />
      <NotificationWatcher
        alerts={urgent}
        push={pushPublicKey() ? { publicKey: pushPublicKey()!, subscribe: subscribePushAction, unsubscribe: unsubscribePushAction } : null}
      />
      <div className="flex items-center gap-3 px-2 pb-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
          {initials(user.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="text-xs text-stone-500">{ROLE_LABEL[ctx.role]}</p>
        </div>
      </div>
      <Link href="/account" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-stone-600 hover:bg-stone-100">
        <Icon name="account" className="size-5 text-stone-400" /> My account
      </Link>
      <form action={logout}>
        <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-stone-600 hover:bg-stone-100">
          <Icon name="logout" className="size-5 text-stone-400" /> Sign out
        </button>
      </form>
    </div>
  );

  return (
    <AppShell brand={brand} top={top} nav={<NavLinks groups={groups} />} bottom={bottom} tabs={tabs} alerts={unreadNotifications.length}>
      {children}
    </AppShell>
  );
}
