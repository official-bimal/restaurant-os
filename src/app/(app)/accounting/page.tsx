import Link from "next/link";
import { requireTenant } from "@/server/auth";
import { can } from "@/server/permissions";
import { currentPeriod, getBalanceSheet, getProfitAndLoss } from "@/features/accounting/server/service";
import { bsText } from "@/features/accounting/fiscal";
import { AccountingTabs, Money } from "./ui";

export const dynamic = "force-dynamic";

export default async function AccountingPage() {
  const ctx = await requireTenant("books.view");
  const p = await currentPeriod(ctx);
  const [pnl, bs] = await Promise.all([getProfitAndLoss(ctx, p.from, p.to), getBalanceSheet(ctx, p.today)]);
  const links = [
    { href: "/accounting/transactions", title: "Transactions", text: "Sales, purchases, income, expenses and payments in one list." },
    { href: "/accounting/cash-banks", title: "Cash and banks", text: "What each account holds, and what came in and went out." },
    ...(can(ctx.role, "books.manage") ? [{ href: "/accounting/new", title: "Add an entry", text: "Income, expense, payment in or out, or a transfer." }] : []),
    { href: "/accounting/daybook", title: "Daybook", text: "Every voucher, day by day." },
    { href: "/accounting/ledger", title: "Ledger", text: "One account with its running balance." },
    { href: "/accounting/trial-balance", title: "Trial balance", text: "Every account, debits against credits." },
    { href: "/accounting/profit-loss", title: "Profit and loss", text: "Income less expenses for a period." },
    { href: "/accounting/balance-sheet", title: "Balance sheet", text: "What the business owns and owes." },
    ...(can(ctx.role, "books.manage") ? [{ href: "/accounting/voucher", title: "New voucher", text: "Record an expense, receipt, transfer or journal." }] : []),
  ];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Accounts</h1>
        <p className="text-sm text-stone-600">
          Fiscal year {p.fiscalYear} ({p.from} to {p.to}; {bsText(p.from)} BS onwards). Bills, refunds and supplier payments are posted here by themselves.
        </p>
      </div>
      <AccountingTabs current="/accounting" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-sm text-stone-600">Income so far this year</p>
          <p className="text-2xl font-semibold"><Money paisa={pnl.income.total} /></p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-stone-600">Expenses so far</p>
          <p className="text-2xl font-semibold"><Money paisa={pnl.expenses.total} /></p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-stone-600">{pnl.profit >= 0 ? "Profit" : "Loss"}</p>
          <p className={`text-2xl font-semibold ${pnl.profit < 0 ? "text-red-700" : "text-emerald-700"}`}><Money paisa={pnl.profit} /></p>
        </div>
      </div>
      <p className={`rounded-lg px-3 py-2 text-sm ${bs.difference === 0 ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
        {bs.difference === 0 ? "The books agree: assets equal liabilities plus equity." : <>The books do not agree (difference <Money paisa={bs.difference} />). Please check recent vouchers.</>}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="card block p-4 hover:border-teal-600">
            <p className="font-medium">{l.title}</p>
            <p className="text-sm text-stone-600">{l.text}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
