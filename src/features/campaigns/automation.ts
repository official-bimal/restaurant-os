/**
 * Automatic campaigns: pure rules, no database. A birthday offer and a win-back message that are worked out every day.
 */

export const RULE_KINDS = ["BIRTHDAY", "WIN_BACK"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export function isRuleKind(value: string): value is RuleKind {
  return (RULE_KINDS as readonly string[]).includes(value);
}

export const RULE_INFO: Record<RuleKind, { label: string; description: string; template: string; offerPoints: number; offerDays: number; cooldownDays: number }> = {
  BIRTHDAY: {
    label: "Birthday offer",
    description: "On a guest's birthday, send a greeting and a bonus-points offer. Needs the guest's birthday (month and day) on their customer page.",
    template: "Happy birthday {name}! {business} has {points} bonus points waiting for you. Visit within {days} days.",
    offerPoints: 100,
    offerDays: 7,
    cooldownDays: 300,
  },
  WIN_BACK: {
    label: "Win-back",
    description: "Message guests who have not visited for over 30 days (the \"At risk\" group) and invite them back.",
    template: "Hi {name}, we miss you at {business}! Come back within {days} days and get {points} bonus points.",
    offerPoints: 50,
    offerDays: 14,
    cooldownDays: 60,
  },
};

/** Messages are only sent between these local hours, so nobody is texted in the middle of the night. */
export const SEND_FROM_HOUR = 9;
export const SEND_UNTIL_HOUR = 20;

export function inSendWindow(hour: number): boolean {
  return hour >= SEND_FROM_HOUR && hour < SEND_UNTIL_HOUR;
}

/** The local hour (0-23) of an instant in a time zone. */
export function localHour(now: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(now);
  return Number(h) % 24;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // February counts 29: a 29 Feb birthday is allowed

export function isValidBirthday(month: unknown, day: unknown): boolean {
  return Number.isInteger(month) && Number.isInteger(day) && (month as number) >= 1 && (month as number) <= 12 && (day as number) >= 1 && (day as number) <= DAYS_IN_MONTH[(month as number) - 1]!;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Whether a birthday (month, day) falls on a local date "YYYY-MM-DD". A 29 February birthday is marked on 28 February in other years. */
export function isBirthdayOn(month: number | null, day: number | null, date: string): boolean {
  if (month === null || day === null || !isValidBirthday(month, day)) return false;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  if (month === 2 && day === 29 && !isLeap(y)) return m === 2 && d === 28;
  return m === month && d === day;
}

/** One automatic campaign per rule per day: a second run on the same day finds this and does nothing. */
export function autoKey(kind: RuleKind, date: string): string {
  return `${kind}:${date}`;
}
