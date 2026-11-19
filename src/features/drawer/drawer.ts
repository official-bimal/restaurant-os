/**
 * The cash drawer. Pure functions, no I/O. Money is integer paisa.
 *
 * What a drawer should hold: the float put in, plus cash taken for bills, less cash handed back as refunds, plus cash put in and less cash taken out
 * by the cashier (a bank deposit, petty cash, the owner), plus cash tips kept in it. The count at handover is compared with that.
 */

export type MoveKind = "BANK_DEPOSIT" | "PETTY_EXPENSE" | "OWNER_TAKES" | "OWNER_ADDS" | "OTHER_IN" | "OTHER_OUT";

export const MOVE_KINDS: MoveKind[] = ["BANK_DEPOSIT", "PETTY_EXPENSE", "OWNER_TAKES", "OWNER_ADDS", "OTHER_IN", "OTHER_OUT"];

export const MOVE_LABEL: Record<MoveKind, string> = {
  BANK_DEPOSIT: "Taken to the bank",
  PETTY_EXPENSE: "Paid out for an expense",
  OWNER_TAKES: "Taken by the owner",
  OWNER_ADDS: "Put in by the owner",
  OTHER_IN: "Other cash in",
  OTHER_OUT: "Other cash out",
};

export const isMoneyIn = (k: MoveKind) => k === "OWNER_ADDS" || k === "OTHER_IN";

export interface DrawerFlows {
  openingFloat: number;
  /** Cash taken for bills since the drawer was opened. */
  cashSales: number;
  /** Cash handed back to customers for refunds. */
  cashRefunds: number;
  moves: { kind: MoveKind; amount: number }[];
  /** Cash tips put in the drawer. */
  cashTips: number;
}

export function movesNet(moves: { kind: MoveKind; amount: number }[]): number {
  return moves.reduce((n, m) => n + (isMoneyIn(m.kind) ? m.amount : -m.amount), 0);
}

/** What the drawer should hold right now. */
export function expectedCash(f: DrawerFlows): number {
  return f.openingFloat + f.cashSales - f.cashRefunds + movesNet(f.moves) + f.cashTips;
}

/** Counted less expected: negative is short, positive is over. */
export function difference(counted: number, expected: number): number {
  return counted - expected;
}

/** Nepali notes and coins, biggest first, for counting by denomination. */
export const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;

/** The value in paisa of a count by denomination: { "500": 3, "100": 7 } is Rs 2,200. Anything that is not a whole count of at least zero is refused. */
export function countTotal(counts: Record<string, number>): number {
  let rupees = 0;
  for (const [d, n] of Object.entries(counts)) {
    const denom = Number(d);
    if (!(DENOMINATIONS as readonly number[]).includes(denom)) throw new RangeError("Unknown note or coin");
    if (!Number.isInteger(n) || n < 0 || n > 100_000) throw new RangeError("A count must be a whole number");
    rupees += denom * n;
  }
  return rupees * 100;
}
