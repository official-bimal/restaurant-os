"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { TONES } from "./palette";
import type { NavItem } from "./nav-links";

/**
 * Sidebar on wide screens. On phones: a slim top bar, a bottom tab bar with the few screens each role uses all day, and a
 * "More" drawer with everything else. The server decides what goes in the slots (so permissions are checked there); this
 * only handles the open/close and which tab is current.
 */
export function AppShell({
  brand,
  top,
  nav,
  bottom,
  tabs,
  alerts,
  children,
}: {
  brand: ReactNode;
  top: ReactNode;
  nav: ReactNode;
  bottom: ReactNode;
  tabs: NavItem[];
  /** Unread notifications, shown on the bell in the top bar. */
  alerts: number;
  children: ReactNode;
}) {
  // The drawer remembers which page it was opened on, so moving to another page closes it.
  const path = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  const setOpen = (v: boolean) => setOpenOn(v ? path : null);

  const panel = (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        {brand}
        <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="grid size-10 place-items-center rounded-xl text-stone-500 hover:bg-stone-100 lg:hidden">
          <Icon name="close" />
        </button>
      </div>
      {top}
      <div className="flex-1">{nav}</div>
      {bottom}
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-stone-200 bg-white print:hidden lg:block">{panel}</aside>

      <header className="app-topbar sticky top-0 z-30 flex items-center gap-3 border-b border-stone-200/80 bg-white/90 px-4 py-2 backdrop-blur print:hidden lg:hidden">
        <div className="min-w-0 flex-1">{brand}</div>
        <Link href="/notifications" aria-label={alerts > 0 ? `${alerts} alerts` : "Alerts"} className="relative grid size-11 place-items-center rounded-xl text-stone-700 active:bg-stone-100">
          <Icon name="bell" className="size-6" />
          {alerts > 0 && (
            <span className="absolute right-1 top-1 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-5 text-white">{alerts > 99 ? "99+" : alerts}</span>
          )}
        </Link>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden print:hidden">
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-stone-900/45" />
          <aside className="absolute inset-y-0 right-0 w-80 max-w-[88vw] rounded-l-3xl bg-white shadow-2xl">{panel}</aside>
        </div>
      )}

      <main className="app-main min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      <nav aria-label="Quick tabs" className="app-tabbar fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur print:hidden lg:hidden">
        <ul className="mx-auto flex max-w-lg items-stretch justify-around">
          {tabs.map((t) => {
            const active = path === t.href || path.startsWith(`${t.href}/`);
            const tone = TONES[t.tone];
            return (
              <li key={t.href} className="flex-1">
                <Link href={t.href} aria-current={active ? "page" : undefined} className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium ${active ? tone.text : "text-stone-500"}`}>
                  <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${active ? tone.activeBg : ""}`}>
                    <Icon name={t.icon} className="size-[22px]" />
                  </span>
                  <span className="max-w-full truncate">{t.label}</span>
                  {!!t.badge && t.badge > 0 && (
                    <span className={`absolute right-[22%] top-1.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold leading-4 text-white ${t.badgeTone === "alert" ? "bg-red-600" : "bg-amber-500"}`}>{t.badge}</span>
                  )}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button type="button" onClick={() => setOpen(true)} aria-label="More" aria-expanded={open} className="flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium text-stone-500">
              <span className="grid h-7 w-12 place-items-center rounded-full">
                <Icon name="menuIcon" className="size-[22px]" />
              </span>
              More
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
