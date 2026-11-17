"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { TONES, type Tone } from "./palette";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  tone: Tone;
  badge?: number;
  /** "alert" is red (needs a manager), anything else is amber (needs attention). */
  badgeTone?: "alert" | "warn";
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  return (
    <nav className="space-y-5" aria-label="Main">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400">{g.label}</p>
          <ul className="space-y-1">
            {g.items.map((i) => {
              const active = path === i.href || path.startsWith(`${i.href}/`);
              const tone = TONES[i.tone];
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-xl px-2 py-2 text-sm font-medium transition-colors ${
                      active ? `${tone.activeBg} ${tone.text}` : "text-stone-600 hover:bg-stone-100"
                    }`}
                  >
                    <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${tone.tile}`}>
                      <Icon name={i.icon} className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{i.label}</span>
                    {!!i.badge && i.badge > 0 && (
                      <span
                        aria-label={`${i.badge} waiting`}
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-white ${i.badgeTone === "alert" ? "bg-red-600" : "bg-amber-500"}`}
                      >
                        {i.badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
