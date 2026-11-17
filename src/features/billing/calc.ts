/**
 * Bill calculation. Pure functions, no I/O.
 *
 * All money is an integer number of paisa (1 NPR = 100 paisa) so there is no
 * floating point drift. Rates are in basis points (1300 = 13.00%).
 */

export type Paisa = number;

export type DiscountInput =
  | { kind: "none" }
  | { kind: "percent"; bps: number }
  | { kind: "amount"; amount: Paisa };

export type VatMode = "EXCLUSIVE" | "INCLUSIVE" | "NONE";

export interface BillLine {
  /** Unit price including chosen variant and modifiers. */
  unitPrice: Paisa;
  quantity: number;
  /** Complimentary lines are listed but charge nothing. */
  complimentary?: boolean;
}

export interface BillConfig {
  discount: DiscountInput;
  /** Reward discount from redeemed loyalty points, applied after the normal discount. */
  loyaltyDiscount?: Paisa;
  /** Service charge in basis points, applied after discount. 0 disables it. */
  serviceChargeBps: number;
  vatMode: VatMode;
  vatBps: number;
  /** When true (common Nepal practice) VAT is charged on service charge too. */
  vatAppliesToServiceCharge: boolean;
  /** Round the grand total to the nearest whole rupee. */
  roundToRupee: boolean;
  /** Delivery fee, added after discounts, service charge and VAT (none of them apply to it). */
  deliveryFee?: Paisa;
  /** Charge VAT on the delivery fee as well (off by default). */
  vatOnDeliveryFee?: boolean;
}

export interface BillTotals {
  subtotal: Paisa;
  discount: Paisa;
  /** Reward discount from redeemed points (0 when none). */
  loyaltyDiscount: Paisa;
  serviceCharge: Paisa;
  /** Delivery fee (0 when none). Included in the total. */
  deliveryFee: Paisa;
  /** VAT amount. For INCLUSIVE mode this is the VAT portion already inside the total. */
  vat: Paisa;
  /** Amount before rounding. */
  totalBeforeRounding: Paisa;
  roundOff: Paisa;
  grandTotal: Paisa;
}

export const DEFAULT_BILL_CONFIG: BillConfig = {
  discount: { kind: "none" },
  serviceChargeBps: 1000,
  vatMode: "EXCLUSIVE",
  vatBps: 1300,
  vatAppliesToServiceCharge: true,
  roundToRupee: true,
};

const BPS = 10_000;

function assertInt(value: number, name: string): void {
  if (!Number.isInteger(value)) throw new RangeError(`${name} must be an integer`);
}

/** Round half up for non-negative integers: round(n * bps / 10000). */
function applyBps(amount: Paisa, bps: number): Paisa {
  return Math.floor((amount * bps + BPS / 2) / BPS);
}

export function calculateBill(lines: BillLine[], config: BillConfig): BillTotals {
  let subtotal = 0;
  for (const line of lines) {
    assertInt(line.unitPrice, "unitPrice");
    assertInt(line.quantity, "quantity");
    if (line.unitPrice < 0 || line.quantity < 0) {
      throw new RangeError("unitPrice and quantity must not be negative");
    }
    if (!line.complimentary) subtotal += line.unitPrice * line.quantity;
  }

  let discount = 0;
  switch (config.discount.kind) {
    case "none":
      break;
    case "percent":
      if (config.discount.bps < 0 || config.discount.bps > BPS) {
        throw new RangeError("discount percent must be between 0 and 100");
      }
      discount = applyBps(subtotal, config.discount.bps);
      break;
    case "amount":
      assertInt(config.discount.amount, "discount amount");
      if (config.discount.amount < 0) throw new RangeError("discount must not be negative");
      discount = Math.min(config.discount.amount, subtotal);
      break;
  }

  const loyaltyDiscount = config.loyaltyDiscount ?? 0;
  assertInt(loyaltyDiscount, "loyalty discount");
  if (loyaltyDiscount < 0) throw new RangeError("loyalty discount must not be negative");
  if (loyaltyDiscount > subtotal - discount) throw new RangeError("The reward is larger than the bill");

  const net = subtotal - discount - loyaltyDiscount;
  const serviceCharge = applyBps(net, config.serviceChargeBps);

  let vat = 0;
  let totalBeforeRounding: Paisa;
  const vatBase = config.vatAppliesToServiceCharge ? net + serviceCharge : net;

  switch (config.vatMode) {
    case "NONE":
      totalBeforeRounding = net + serviceCharge;
      break;
    case "EXCLUSIVE":
      vat = applyBps(vatBase, config.vatBps);
      totalBeforeRounding = net + serviceCharge + vat;
      break;
    case "INCLUSIVE":
      // Prices already contain VAT: extract it, do not add it.
      vat = Math.round((vatBase * config.vatBps) / (BPS + config.vatBps));
      totalBeforeRounding = net + serviceCharge;
      break;
  }

  const deliveryFee = config.deliveryFee ?? 0;
  assertInt(deliveryFee, "delivery fee");
  if (deliveryFee < 0) throw new RangeError("delivery fee must not be negative");
  totalBeforeRounding += deliveryFee;
  // Optionally the fee carries VAT too (never service charge). Exclusive: VAT is added on top of it.
  // Inclusive: the fee already contains its VAT, so only the VAT part is worked out for the records.
  if (config.vatOnDeliveryFee && deliveryFee > 0) {
    if (config.vatMode === "EXCLUSIVE") {
      const feeVat = applyBps(deliveryFee, config.vatBps);
      vat += feeVat;
      totalBeforeRounding += feeVat;
    } else if (config.vatMode === "INCLUSIVE") {
      vat += Math.round((deliveryFee * config.vatBps) / (BPS + config.vatBps));
    }
  }

  const grandTotal = config.roundToRupee
    ? Math.round(totalBeforeRounding / 100) * 100
    : totalBeforeRounding;

  return {
    subtotal,
    discount,
    loyaltyDiscount,
    serviceCharge,
    deliveryFee,
    vat,
    totalBeforeRounding,
    roundOff: grandTotal - totalBeforeRounding,
    grandTotal,
  };
}

/** Format paisa as "Rs 1,234.50" (no decimals when whole). */
export function formatNpr(amount: Paisa): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const rupees = Math.floor(abs / 100);
  const paisa = abs % 100;
  const grouped = rupees.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}Rs ${grouped}${paisa ? "." + paisa.toString().padStart(2, "0") : ""}`;
}
