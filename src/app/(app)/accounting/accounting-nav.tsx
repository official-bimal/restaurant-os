"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Item {
  href: string;
  label: string;
  /** Only the owner (who can change the books) sees it. */
  manage?: boolean;
}
interface Group {
  label: string;
  items: Item[];
}

const GROUPS: Group[] = [
  { label: "", items: [{ href: "/accounting", label: "Overview" }] },
  {
    label: "Money",
    items: [
      { href: "/accounting/transactions", label: "Transactions" },
      { href: "/accounting/new", label: "Add an entry", manage: true },
      { href: "/accounting/cash-banks", label: "Cash and banks" },
      { href: "/accounting/daybook", label: "Day book" },
    ],
  },
  {
    label: "Books",
    items: [
      { href: "/accounting/voucher", label: "Journal voucher", manage: true },
      { href: "/accounting/ledger", label: "Ledger" },
      { href: "/accounting/trial-balance", label: "Trial balance" },
      { href: "/accounting/profit-loss", label: "Profit and loss" },
      { href: "/accounting/balance-sheet", label: "Balance sheet" },
      { href: "/accounting/accounts", label: "Chart of accounts" },
    ],
  },
  {
    label: "Tax",
    items: [
      { href: "/accounting/sales-book", label: "Sales book" },
      { href: "/accounting/purchase-book", label: "Purchase book" },
      { href: "/accounting/vat", label: "VAT summary" },
      { href: "/accounting/tds", label: "TDS" },
    ],
  },
  {
    label: "Period end",
    items: [
      { href: "/accounting/reconcile", label: "Bank reconciliation" },
      { href: "/accounting/assets", label: "Fixed assets" },
      { href: "/accounting/budget", label: "Budget" },
      { href: "/accounting/opening-balances", label: "Opening balances", manage: true },
      { href: "/accounting/year-end", label: "Year-end" },
    ],
  },
  {
    label: "",
    items: [
      { href: "/accounting/exports", label: "Downloads (CSV)" },
      { href: "/accounting/audit-log", label: "Audit log" },
    ],
  },
];

/** The Accounts menu: a list down the side on a computer, a row you can slide along on a phone. */
export function AccountingNav({ canManage }: { canManage: boolean }) {
  const path = usePathname();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canManage || !i.manage) })).filter((g) => g.items.length > 0);
  const active = (href: string) => (href === "/accounting" ? path === href : path === href || path.startsWith(`${href}/`));

  return (
    <>
      <nav aria-label="Accounts" className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-3 lg:hidden">
        {groups.flatMap((g) => g.items).map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active(i.href) ? "page" : undefined}
            className={`min-h-9 shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${active(i.href) ? "bg-brand-600 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200"}`}
          >
            {i.label}
          </Link>
        ))}
      </nav>
      <nav aria-label="Accounts" className="hidden w-52 shrink-0 lg:block">
        <div className="sticky top-6 space-y-4">
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.label && <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-stone-500">{g.label}</p>}
              <ul className="space-y-0.5">
                {g.items.map((i) => (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      aria-current={active(i.href) ? "page" : undefined}
                      className={`block rounded-lg px-3 py-2 text-[15px] ${active(i.href) ? "bg-brand-50 font-semibold text-brand-700" : "font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}
                    >
                      {i.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
