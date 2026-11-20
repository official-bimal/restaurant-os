import type { TenantContext } from "@/server/auth";
import { can } from "@/server/permissions";
import { DomainError } from "@/server/errors";
import { isValidDate } from "@/lib/business-day";
import { rupees, toCsv } from "@/lib/csv";
import { bsText } from "../fiscal";
import { booksCsv, getPurchaseBook, getSalesBook, getVatSummary } from "./registers";
import { getBalanceSheet, getDaybook, getLedger, getProfitAndLoss, getTrialBalance } from "./service";
import { getTdsReport, listAssets } from "./extras";
import { listTransactions } from "./easy";

/**
 * Every book as a CSV file for the accountant. Needs `books.view`, which the owner, managers and the accountant role have.
 * Money is written in rupees with two decimals, as numbers, so a spreadsheet can add them up.
 */

export const EXPORT_KINDS = ["transactions", "sales", "purchase", "vat", "tds", "trial-balance", "profit-loss", "balance-sheet", "daybook", "ledger", "assets"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_LABEL: Record<ExportKind, string> = {
  transactions: "Transactions (every sale, purchase, income, expense and payment)",
  sales: "Sales book (every bill and credit note, with VAT)",
  purchase: "Purchase book (supplier bills, with VAT)",
  vat: "VAT summary by Nepali month",
  tds: "TDS deducted from suppliers",
  "trial-balance": "Trial balance",
  "profit-loss": "Profit and loss",
  "balance-sheet": "Balance sheet",
  daybook: "Day book (every voucher with its lines)",
  ledger: "Ledger of one account",
  assets: "Fixed assets",
};

export async function buildExport(ctx: TenantContext, kind: string, q: { from: string; to: string; account?: string }): Promise<{ filename: string; csv: string }> {
  if (!can(ctx, "books.view")) throw new DomainError("You do not have permission to see the accounts.");
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) throw new DomainError("Unknown export.");
  if (!isValidDate(q.from) || !isValidDate(q.to) || q.from > q.to) throw new DomainError("Choose valid dates.");
  const { from, to } = q;
  const name = (k: string) => `${k}-${from}-to-${to}.csv`;

  switch (kind as ExportKind) {
    case "sales": {
      const b = await getSalesBook(ctx, from, to);
      return { filename: name("sales-book"), csv: booksCsv(b.rows, "Buyer") };
    }
    case "purchase": {
      const b = await getPurchaseBook(ctx, from, to);
      return { filename: name("purchase-book"), csv: booksCsv(b.rows, "Supplier") };
    }
    case "transactions": {
      const r = await listTransactions(ctx, { from, to });
      return {
        filename: name("transactions"),
        csv: toCsv(
          ["Date", "Date (BS)", "No.", "Type", "Details", "Who", "Through", "Made by", "Amount", "Status"],
          r.rows.map((t) => [t.date, bsText(t.date), t.number, t.typeLabel, t.particular, t.party, t.mode, t.by, rupees(t.amount), t.reversed ? "Reversed" : "Done"]),
        ),
      };
    }
    case "vat": {
      const v = await getVatSummary(ctx, from, to);
      return {
        filename: name("vat-summary"),
        csv: toCsv(
          ["Nepali month", "Taxable sales", "VAT collected", "Taxable purchases", "VAT paid", "To pay (carry forward if negative)"],
          [...v.months.map((m) => [m.monthName, rupees(m.taxableSales), rupees(m.outputVat), rupees(m.taxablePurchases), rupees(m.inputVat), rupees(m.net)]), ["Total", rupees(v.totals.taxableSales), rupees(v.totals.outputVat), rupees(v.totals.taxablePurchases), rupees(v.totals.inputVat), rupees(v.totals.net)]],
        ),
      };
    }
    case "tds": {
      const t = await getTdsReport(ctx, from, to);
      return {
        filename: name("tds"),
        csv: toCsv(
          ["Nepali month", "Deposit by", "Date (BS)", "Supplier", "PAN", "Bill", "Bill total", "TDS"],
          t.months.flatMap((m) => m.rows.map((r) => [m.monthName, m.dueBy, r.bs, r.supplier, r.pan, r.bill, rupees(r.gross), rupees(r.tds)])),
        ),
      };
    }
    case "trial-balance": {
      const t = await getTrialBalance(ctx, to);
      return {
        filename: `trial-balance-as-at-${to}.csv`,
        csv: toCsv(["Code", "Account", "Kind", "Debit", "Credit"], [...t.rows.map((r) => [r.account.code, r.account.name, r.account.type, rupees(r.debit), rupees(r.credit)]), ["", "Total", "", rupees(t.totalDebit), rupees(t.totalCredit)]]),
      };
    }
    case "profit-loss": {
      const p = await getProfitAndLoss(ctx, from, to);
      return {
        filename: name("profit-and-loss"),
        csv: toCsv(
          ["Section", "Code", "Account", "Amount"],
          [
            ...p.income.rows.map((r) => ["Income", r.account.code, r.account.name, rupees(r.amount)]),
            ["Income", "", "Total income", rupees(p.income.total)],
            ...p.expenses.rows.map((r) => ["Expenses", r.account.code, r.account.name, rupees(r.amount)]),
            ["Expenses", "", "Total expenses", rupees(p.expenses.total)],
            ["Result", "", p.profit >= 0 ? "Net profit" : "Net loss", rupees(p.profit)],
          ],
        ),
      };
    }
    case "balance-sheet": {
      const b = await getBalanceSheet(ctx, to);
      return {
        filename: `balance-sheet-as-at-${to}.csv`,
        csv: toCsv(
          ["Section", "Code", "Account", "Amount"],
          [
            ...b.assets.rows.map((r) => ["Assets", r.account.code, r.account.name, rupees(r.amount)]),
            ["Assets", "", "Total assets", rupees(b.assets.total)],
            ...b.liabilities.rows.map((r) => ["Liabilities", r.account.code, r.account.name, rupees(r.amount)]),
            ["Liabilities", "", "Total liabilities", rupees(b.liabilities.total)],
            ...b.equity.rows.map((r) => ["Equity", r.account.code, r.account.name, rupees(r.amount)]),
            ["Equity", "", "Profit so far", rupees(b.profit)],
            ["Equity", "", "Total equity", rupees(b.equityTotal)],
          ],
        ),
      };
    }
    case "daybook": {
      const d = await getDaybook(ctx, from, to);
      return {
        filename: name("day-book"),
        csv: toCsv(
          ["Date", "Date (BS)", "Voucher", "No.", "Details", "Account code", "Account", "Debit", "Credit"],
          d.entries.flatMap((e) => e.lines.map((l) => [e.date, bsText(e.date), e.voucher, `${e.fiscalYear} #${e.number}`, e.narration, l.account.code, l.account.name, rupees(l.debit), rupees(l.credit)])),
        ),
      };
    }
    case "ledger": {
      if (!q.account) throw new DomainError("Choose an account.");
      const g = await getLedger(ctx, q.account, from, to);
      return {
        filename: `ledger-${g.account.code}-${from}-to-${to}.csv`,
        csv: toCsv(
          ["Date", "Voucher", "Details", "Debit", "Credit", "Balance"],
          [["", "", "Brought forward", "", "", rupees(g.broughtForward)], ...g.rows.map((r) => [r.date, r.number, r.narration, rupees(r.debit), rupees(r.credit), rupees(r.balance)])],
        ),
      };
    }
    case "assets": {
      const a = await listAssets(ctx);
      return {
        filename: "fixed-assets.csv",
        csv: toCsv(
          ["Asset", "Bought", "Cost", "Yearly rate %", "Depreciation so far", "Value now", "Sold or scrapped"],
          a.map((x) => [x.name, x.purchaseDate, rupees(x.cost), x.rateBps / 100, rupees(x.accumulated), rupees(x.bookValue), x.disposedOn]),
        ),
      };
    }
  }
}
