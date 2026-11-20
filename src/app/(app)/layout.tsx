import { unseenAlertCount } from "@/features/owner/server/owner";
import { hukkaAlertCount } from "@/features/hukka/server/service";
import { reservationsWaitingCount } from "@/features/reservations/server/service";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { requireTenant } from "@/server/auth";
import { logout } from "@/app/login/actions";
import { inboxCount } from "@/features/guest/server/service";
import { onlineInboxCount } from "@/features/online/server/service";
import { unresolvedCount } from "@/features/feedback/server/service";
import { lowStockCount } from "@/features/stock/server/service";
import { listMyBranches } from "@/features/branches/server/service";
import { listNotifications } from "@/features/notifications/server/service";
import { switchBranchAction } from "./branches/actions";
import { AppShell } from "@/components/app-shell";
import { NavLinks, type NavItem } from "@/components/nav-links";
import { buildNav } from "@/features/nav/nav";
import { BranchSwitcher } from "@/components/branch-switcher";
import { Icon } from "@/components/icons";
import { NotificationWatcher } from "@/components/notification-watcher";
import { RegisterWorker } from "@/components/register-worker";
import { ClockWidget } from "@/components/clock-widget";
import { myClock } from "@/features/payroll/server/time";
import { getTheme } from "@/features/dashboard/server/preferences";
import { accentVars } from "@/features/appearance/theme";
import { PRODUCT_NAME } from "@/lib/product";
import { pushPublicKey } from "@/features/notifications/server/push";
import { subscribePushAction, unsubscribePushAction } from "./notifications/push-actions";

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  WAITER: "Waiter",
  KITCHEN: "Kitchen",
  RIDER: "Rider",
  ACCOUNTANT: "Accountant",
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
  const [theme, logo, business, user, waiting, lowRatings, lowStock, myBranches, notifications, clock, ownerAlerts, onlineWaiting, hukkaLong, hukkaCategories, reservationsWaiting] = await Promise.all([
    getTheme(ctx),
    db.businessLogo.findUnique({ where: { businessId: ctx.businessId }, select: { updatedAt: true } }),
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
    hukkaAlertCount(ctx),
    db.menuCategory.count({ where: { businessId: ctx.businessId, OR: [{ name: { contains: "hukka", mode: "insensitive" } }, { name: { contains: "shisha", mode: "insensitive" } }, { name: { contains: "hookah", mode: "insensitive" } }] } }),
    reservationsWaitingCount(ctx),
  ]);
  const hukkaOn = hukkaCategories > 0;

  // The badge and the chime follow what this person has not read yet.
  const unreadNotifications = notifications.filter((n) => !n.read);
  const urgent = unreadNotifications.filter((n) => n.level === "alert").map((n) => ({ id: n.id, title: n.title }));

  const { home, sections } = buildNav({
    role: ctx.role,
    permissions: ctx.permissions,
    multiBranch: business.multiBranch,
    hukka: hukkaOn,
    counts: { notifications: unreadNotifications.length, guestWaiting: waiting, onlineWaiting, reservationsWaiting, hukkaLong, lowStock, lowRatings, ownerAlerts },
  });

  // The few screens each role uses all day sit in the phone's bottom bar; everything else is under "More".
  const PREFERRED: Record<string, string[]> = {
    OWNER: ["/dashboard", "/orders", "/kitchen", "/notifications"],
    MANAGER: ["/dashboard", "/orders", "/kitchen", "/notifications"],
    CASHIER: ["/orders", "/quick", "/kitchen", "/notifications"],
    WAITER: ["/orders", "/quick", "/kitchen", "/notifications"],
    KITCHEN: ["/kitchen", "/notifications", "/stock"],
    ACCOUNTANT: ["/dashboard", "/accounting", "/reports", "/bills"],
  };
  const everyItem: NavItem[] = [...home, ...sections.flatMap((g) => g.items)].map((e) => ({ href: e.href, label: e.label, icon: e.icon, tone: "teal" as const, badge: e.badge, badgeTone: e.badgeTone }));
  const tabs = (PREFERRED[ctx.role] ?? PREFERRED.WAITER!).flatMap((href) => everyItem.filter((i) => i.href === href)).slice(0, 4);

  // The top of the sidebar is the business: its logo, or a monogram and name when none is uploaded. Switching branch is a small selector under it.
  const brand = (
    <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5" aria-label={`${business.name}, dashboard`}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/logo?v=${logo.updatedAt.getTime()}`} alt={business.name} className="brand-logo h-11 w-auto max-w-[12rem] object-contain" />
      ) : (
        <>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white">{initials(business.name) || "R"}</span>
          <span className="min-w-0 truncate text-base font-semibold tracking-tight">{business.name}</span>
        </>
      )}
    </Link>
  );

  const top = business.multiBranch && myBranches.length > 1 ? <BranchSwitcher action={switchBranchAction} branches={myBranches} current={ctx.branchId} /> : null;

  const bottom = (
    <div className="space-y-2 border-t border-stone-200 pt-3">
      <ClockWidget since={clock.since ? clock.since.toISOString() : null} workedTodayMinutes={clock.workedTodayMinutes} timeZone={business.timezone} askLocation={business.clockRequireLocation} />
      <RegisterWorker />
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
      <p className="pt-1 text-center text-[11px] tracking-wide text-stone-400">Powered by {PRODUCT_NAME}</p>
    </div>
  );

  return (
    <div data-ui={theme.mode.toLowerCase()} style={accentVars(theme.accent) as React.CSSProperties} className="min-h-screen">
    <AppShell brand={brand} top={top} nav={<NavLinks home={home} sections={sections} />} bottom={bottom} tabs={tabs} alerts={unreadNotifications.length}>
      {children}
    </AppShell>
    </div>
  );
}
