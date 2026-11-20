import Link from "next/link";

const TABS = [
  { href: "/printing", label: "Paper and queue" },
  { href: "/printing/printers", label: "Printers and routing" },
  { href: "/printing/fields", label: "What prints" },
];

/** The three Printing pages, side by side. */
export function PrintingTabs({ current }: { current: string }) {
  return (
    <nav aria-label="Printing" className="flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === current ? "page" : undefined} className={`min-h-9 rounded-lg px-4 py-2 text-sm font-medium ${t.href === current ? "bg-white text-brand-700 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
