/**
 * Online ordering: the limits and the small pure rules. No database here.
 */

export const LIMITS = {
  linesPerOrder: 30,
  quantityPerLine: 20,
  /** Orders one phone number may have waiting for the restaurant at once. */
  pendingPerPhone: 2,
  /** Orders waiting at one branch at once, so a flood cannot bury the staff. */
  pendingPerBranch: 40,
  noteLength: 200,
  nameLength: 60,
  addressLength: 200,
  /** A request nobody answers in this long expires. */
  staleMinutes: 60,
} as const;

/** The public link token: random, URL-safe, long enough that it cannot be guessed. */
export const TOKEN_FORMAT = /^[A-Za-z0-9_-]{16,64}$/;

export function isToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_FORMAT.test(value);
}

/** Trim, collapse blank runs and cut to length. Control characters are removed (they have no place in a name or an address). */
export function cleanText(value: string | null | undefined, max: number): string {
  return (value ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export type OnlineType = "TAKEAWAY" | "DELIVERY";

export function isOnlineType(value: unknown): value is OnlineType {
  return value === "TAKEAWAY" || value === "DELIVERY";
}

/** What the customer is told about timing. */
export function prepMessage(minutes: number, type: OnlineType): string {
  const m = Math.max(5, Math.round(minutes / 5) * 5);
  return type === "DELIVERY" ? `About ${m} minutes to prepare, plus the ride to you.` : `Ready for pickup in about ${m} minutes.`;
}

/** True when a waiting request has gone unanswered for too long. */
export function isStale(createdAt: Date, now: Date, staleMinutes: number = LIMITS.staleMinutes): boolean {
  return now.getTime() - createdAt.getTime() > staleMinutes * 60_000;
}

/** Customer-facing words for each state of an online order. */
export function statusText(status: "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED" | "EXPIRED"): { title: string; detail: string } {
  switch (status) {
    case "PENDING":
      return { title: "Waiting for the restaurant", detail: "We have your order. The restaurant will accept it shortly. You can keep this page open." };
    case "ACCEPTED":
      return { title: "Accepted", detail: "The restaurant is preparing your order." };
    case "REJECTED":
      return { title: "Sorry, we could not take this order", detail: "" };
    case "CANCELLED":
      return { title: "Cancelled", detail: "You cancelled this order." };
    case "EXPIRED":
      return { title: "No answer in time", detail: "The restaurant did not answer in time, so this order was not taken. Please try again or call us." };
  }
}
