/**
 * Nepal tax-invoice helpers (Inland Revenue Department). Pure functions, no I/O.
 *
 * Rules taken from the Electronic Billing Procedure 2074 as described by secondary sources; check the official text.
 * Seller PAN, a number that is never reused, the fiscal year, both calendars on the bill, VAT shown separately, buyer
 * PAN when the buyer is a business, "copy of original" on reprints, and corrections only by credit note.
 */
import { bsText, fiscalYearOf } from "@/features/accounting/fiscal";
import { localDate } from "@/lib/business-day";

/** The number as written on the bill: fiscal year, then the number. Example: 2083/84-12. */
export function invoiceLabel(fiscalYear: string, number: number): string {
  return `${fiscalYear}-${number}`;
}

/** Fiscal year, English date and Nepali date of an invoice or credit note made at an instant. */
export function billDates(at: Date, timeZone: string) {
  const date = localDate(at, timeZone);
  return { date, bs: bsText(date), fiscalYear: fiscalYearOf(date) };
}

/** A Nepali PAN is nine digits. */
export function isValidPan(value: string): boolean {
  return /^\d{9}$/.test(value);
}

/** Buyer details typed at the till. A PAN needs the buyer's name beside it. Empty means a plain customer bill. */
export function cleanBuyer(rawName: string | null | undefined, rawPan: string | null | undefined): { name: string | null; pan: string | null } | { error: string } {
  const name = (rawName ?? "").trim().replace(/\s+/g, " ");
  const pan = (rawPan ?? "").trim();
  if (name.length > 120) return { error: "The buyer name is too long (120 characters at most)." };
  if (pan && !isValidPan(pan)) return { error: "A PAN has nine digits." };
  if (pan && !name) return { error: "Enter the buyer name beside the PAN." };
  return { name: name || null, pan: pan || null };
}

/** The line printed on a reprint, or null for the first (original) print. `printsBefore` is how many times it was printed earlier. */
export function copyNote(printsBefore: number): string | null {
  return printsBefore > 0 ? `COPY OF ORIGINAL (reprint ${printsBefore})` : null;
}

export interface TaxableInput {
  grandTotal: number;
  serviceCharge: number;
  vat: number;
  deliveryFee: number;
}

/**
 * Splits a bill for the sales book into the part VAT was charged on and the part it was not. A bill with no VAT is all non-taxable.
 * The rounding to the whole rupee is left inside the taxable part, so total = taxable + non-taxable + VAT always holds.
 */
export function taxSplit(b: TaxableInput, rules: { vatAppliesToServiceCharge: boolean; vatOnDeliveryFee: boolean }) {
  if (b.vat === 0) return { taxable: 0, nonTaxable: b.grandTotal, vat: 0 };
  const nonTaxable = (rules.vatOnDeliveryFee ? 0 : b.deliveryFee) + (rules.vatAppliesToServiceCharge ? 0 : b.serviceCharge);
  return { taxable: b.grandTotal - b.vat - nonTaxable, nonTaxable, vat: b.vat };
}
