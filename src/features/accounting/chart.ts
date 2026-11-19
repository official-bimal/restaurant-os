/**
 * The chart of accounts every business starts with (a restaurant's, in Nepali practice). Accounts with a `key` are the ones the system
 * posts to by itself; they can be renamed but not removed. Pure data.
 */
export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

export interface DefaultAccount {
  code: string;
  name: string;
  type: AccountType;
  key?: string;
}

export const DEFAULT_CHART: readonly DefaultAccount[] = [
  { code: "1010", name: "Cash in hand", type: "ASSET", key: "CASH" },
  { code: "1020", name: "Bank account", type: "ASSET", key: "BANK" },
  { code: "1030", name: "QR / wallet receipts", type: "ASSET", key: "WALLET" },
  { code: "1040", name: "Card settlements receivable", type: "ASSET", key: "CARD" },
  { code: "1050", name: "Customers owing (credit sales)", type: "ASSET", key: "RECEIVABLE" },
  { code: "1100", name: "Stock of food and drink", type: "ASSET", key: "INVENTORY" },
  { code: "1200", name: "VAT paid on purchases (input VAT)", type: "ASSET", key: "VAT_INPUT" },
  { code: "1500", name: "Furniture, kitchen equipment and fixtures", type: "ASSET", key: "FIXED_ASSETS" },
  { code: "1510", name: "Depreciation so far (reduces fixed assets)", type: "ASSET", key: "ACC_DEPRECIATION" },
  { code: "2010", name: "Suppliers owed (accounts payable)", type: "LIABILITY", key: "PAYABLE" },
  { code: "2100", name: "VAT collected on sales (output VAT)", type: "LIABILITY", key: "VAT_OUTPUT" },
  { code: "2200", name: "TDS payable", type: "LIABILITY", key: "TDS_PAYABLE" },
  { code: "2300", name: "Salaries payable", type: "LIABILITY", key: "SALARY_PAYABLE" },
  { code: "2350", name: "Tips held for staff", type: "LIABILITY", key: "TIPS_PAYABLE" },
  { code: "2400", name: "Loans", type: "LIABILITY" },
  { code: "3010", name: "Owner's capital", type: "EQUITY", key: "CAPITAL" },
  { code: "3020", name: "Owner's drawings", type: "EQUITY", key: "DRAWINGS" },
  { code: "3900", name: "Profit brought forward", type: "EQUITY", key: "RETAINED" },
  { code: "4010", name: "Food and drink sales", type: "INCOME", key: "SALES" },
  { code: "4020", name: "Service charge income", type: "INCOME", key: "SERVICE_CHARGE" },
  { code: "4030", name: "Delivery fee income", type: "INCOME", key: "DELIVERY" },
  { code: "4090", name: "Sales returns (refunds)", type: "INCOME", key: "SALES_RETURNS" },
  { code: "4900", name: "Other income", type: "INCOME", key: "OTHER_INCOME" },
  { code: "4950", name: "Rounding differences", type: "INCOME", key: "ROUND_OFF" },
  { code: "5010", name: "Purchases (food and drink)", type: "EXPENSE", key: "PURCHASES" },
  { code: "5020", name: "Stock wasted", type: "EXPENSE", key: "WASTE" },
  { code: "5100", name: "Salaries and wages", type: "EXPENSE", key: "SALARIES" },
  { code: "5200", name: "Rent", type: "EXPENSE" },
  { code: "5300", name: "Electricity, water and gas", type: "EXPENSE" },
  { code: "5400", name: "Repairs and maintenance", type: "EXPENSE" },
  { code: "5500", name: "Marketing", type: "EXPENSE" },
  { code: "5600", name: "Bank and card charges", type: "EXPENSE" },
  { code: "5650", name: "Cash over and short", type: "EXPENSE", key: "CASH_DIFF" },
  { code: "5700", name: "Depreciation", type: "EXPENSE", key: "DEPRECIATION" },
  { code: "5900", name: "Other expenses", type: "EXPENSE", key: "OTHER_EXPENSE" },
];

export const ACCOUNT_TYPES: readonly AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];

/** Debit-normal accounts grow with debits; the rest grow with credits. */
export function debitNormal(type: AccountType): boolean {
  return type === "ASSET" || type === "EXPENSE";
}
