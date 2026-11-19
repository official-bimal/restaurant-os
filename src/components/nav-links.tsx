"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import type { Tone } from "./palette";
import { sectionOf, type NavEntry, type NavSection } from "@/features/nav/nav";

/** What the phone's bottom bar needs for one tab. */
export interface NavItem {
  href: string;
  label: string;
  icon: string;
  tone: Tone;
  badge?: number;
  badgeTone?: "alert" | "warn";
}

const isActive = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

function Badge({ n, tone }: { n: number; tone?: "alert" | "warn" }) {
  return (
    <span aria-label={`${n} waiting`} className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white ${tone === "alert" ? "bg-red-600" : "bg-amber-500"}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function Row({ e, path }: { e: NavEntry; path: string }) {
  const active = isActive(path, e.href);
  return (
    <Link
      href={e.href}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] transition-colors ${active ? "bg-brand-50 font-semibold text-brand-700" : "font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}
    >
      <Icon name={e.icon} className={`size-[18px] shrink-0 ${active ? "text-brand-600" : "text-stone-400 group-hover:text-stone-600"}`} />
      <span className="min-w-0 flex-1 truncate">{e.label}</span>
      {!!e.badge && e.badge > 0 && <Badge n={e.badge} tone={e.badgeTone} />}
    </Link>
  );
}

/**
 * The sidebar: the dashboard and notifications on top, then sections that fold up (Service, Menu and stock, Customers, Money, Team, Settings).
 * The section you are in stays open, and Service starts open; open and close the rest as you like.
 */
export function NavLinks({ home, sections }: { home: NavEntry[]; sections: NavSection[] }) {
  const path = usePathname();
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const here = sectionOf(sections, path);
  const isOpen = (id: string) => toggled[id] ?? (id === here || id === "service");

  return (
    <nav className="space-y-4" aria-label="Main">
      <ul className="space-y-0.5">
        {home.map((e) => (
          <li key={e.href}>
            <Row e={e} path={path} />
          </li>
        ))}
      </ul>
      {sections.map((s) => {
        const open = isOpen(s.id);
        const waiting = s.items.reduce((n, i) => n + (i.badge ?? 0), 0);
        return (
          <div key={s.id}>
            <button
              type="button"
              onClick={() => setToggled((t) => ({ ...t, [s.id]: !open }))}
              aria-expanded={open}
              aria-controls={`nav-${s.id}`}
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-stone-500 hover:text-stone-800"
            >
              <span className="flex-1">{s.label}</span>
              {!open && waiting > 0 && <Badge n={waiting} tone="warn" />}
              <Icon name="chevron" className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
            </button>
            {open && (
              <ul id={`nav-${s.id}`} className="mt-0.5 space-y-0.5">
                {s.items.map((e) => (
                  <li key={e.href}>
                    <Row e={e} path={path} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
