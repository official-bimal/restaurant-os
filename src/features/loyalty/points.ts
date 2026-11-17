/**
 * Loyalty point maths. Pure functions, no I/O. Money is integer paisa.
 */

export interface LoyaltySettings {
  enabled: boolean;
  /** Points earned per Rs 100 of the final bill. */
  pointsPer100: number;
  /** Redeem in blocks of this many points... */
  redeemPoints: number;
  /** ...each block taking this many paisa off the bill. */
  redeemValue: number;
}

/** Points for a paid bill: floor(final bill in rupees * pointsPer100 / 100). Zero if disabled. */
export function pointsEarned(grandTotal: number, settings: Pick<LoyaltySettings, "enabled" | "pointsPer100">): number {
  if (!settings.enabled || grandTotal <= 0 || settings.pointsPer100 <= 0) return 0;
  return Math.floor((grandTotal * settings.pointsPer100) / 10_000);
}

export class RedemptionError extends Error {}

/**
 * The bill discount for redeeming `points`. Points must be a whole number of blocks.
 * Throws RedemptionError with a message that is safe to show staff.
 */
export function redemptionDiscount(points: number, settings: Pick<LoyaltySettings, "redeemPoints" | "redeemValue">): number {
  if (!Number.isInteger(points) || points < 0) throw new RedemptionError("Points must be a whole number.");
  if (points === 0) return 0;
  if (settings.redeemPoints <= 0 || settings.redeemValue <= 0) throw new RedemptionError("Rewards are not set up.");
  if (points % settings.redeemPoints !== 0) {
    throw new RedemptionError(`Redeem in blocks of ${settings.redeemPoints} points.`);
  }
  return (points / settings.redeemPoints) * settings.redeemValue;
}

/** How many redeem blocks this customer could use on a bill (limited by balance and the bill). */
export function maxRedeemBlocks(
  balance: number,
  discountableAmount: number,
  settings: Pick<LoyaltySettings, "redeemPoints" | "redeemValue">,
): number {
  if (settings.redeemPoints <= 0 || settings.redeemValue <= 0) return 0;
  const byBalance = Math.floor(balance / settings.redeemPoints);
  const byBill = Math.floor(Math.max(0, discountableAmount) / settings.redeemValue);
  return Math.max(0, Math.min(byBalance, byBill));
}

export function validateSettings(s: LoyaltySettings): string | null {
  const int = (n: number) => Number.isInteger(n);
  if (!int(s.pointsPer100) || s.pointsPer100 < 0 || s.pointsPer100 > 1000) return "Points per Rs 100 must be 0 to 1000.";
  if (!int(s.redeemPoints) || s.redeemPoints < 1 || s.redeemPoints > 100_000) return "Redeem block must be 1 to 100,000 points.";
  if (!int(s.redeemValue) || s.redeemValue < 100 || s.redeemValue > 100_000_00) return "Reward value must be between Rs 1 and Rs 100,000.";
  // Guard against a program that gives away more than it takes in (e.g. 10 pts/Rs100 but 10 pts = Rs 500).
  const earnRateValue = (s.pointsPer100 * s.redeemValue) / s.redeemPoints; // paisa back per Rs 100 spent
  if (earnRateValue > 10_000) return "That gives back more than the bill. Lower the points or the reward value.";
  return null;
}
