import Link from "next/link";

const TABS = [
  { key: "dishes", href: "/menu", label: "Dishes" },
  { key: "branch", href: "/menu/branch", label: "This branch" },
  { key: "extras", href: "/menu/extras", label: "Add-ons and extras" },
  { key: "sets", href: "/menu/sets", label: "Menu sets and schedule" },
] as const;

/** Sub-navigation shared by the three menu pages. */
export function MenuTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-stone-200/60 p-1" role="tablist" aria-label="Menu sections">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          role="tab"
          aria-selected={t.key === current}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            t.key === current ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
