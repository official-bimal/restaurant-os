/**
 * Feedback helpers. Pure functions, no I/O.
 */

/** Ratings at or below this need a manager's attention. */
export const LOW_RATING_MAX = 3;
/** How long after paying a guest can still rate or comment. */
export const FEEDBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
export const COMMENT_MAX = 500;
/** A dish shows its stars to guests only once at least this many guests have rated it, so one opinion is not "the" rating. */
export const DISH_RATING_MIN_COUNT = 3;

/** What a guest sees for a dish: the average to one decimal, or null while it has too few ratings. */
export function publicDishRating(total: number, count: number): { average: number; count: number } | null {
  if (!Number.isFinite(total) || !Number.isInteger(count) || count < DISH_RATING_MIN_COUNT) return null;
  return { average: Math.round((total / count) * 10) / 10, count };
}

export function isValidRating(value: unknown): value is 1 | 2 | 3 | 4 | 5 {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function needsAttention(rating: number): boolean {
  return rating <= LOW_RATING_MAX;
}

export function withinWindow(closedAt: Date, now: Date = new Date()): boolean {
  const age = now.getTime() - closedAt.getTime();
  return age >= 0 && age <= FEEDBACK_WINDOW_MS;
}

export interface RatingSummary {
  count: number;
  /** One decimal place, or null when there are no ratings. */
  average: number | null;
  /** Index 0 is one star, index 4 is five stars. */
  distribution: [number, number, number, number, number];
}

export function summarizeRatings(ratings: number[]): RatingSummary {
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let total = 0;
  let count = 0;
  for (const r of ratings) {
    if (!isValidRating(r)) continue;
    distribution[r - 1] += 1;
    total += r;
    count += 1;
  }
  return { count, average: count ? Math.round((total / count) * 10) / 10 : null, distribution };
}

/**
 * The public review page guests are pointed to. Only https links are accepted: the address is
 * shown to guests as a link, so anything else (javascript:, data:, http:) is refused.
 * Returns the cleaned address, or null for "none"; throws a readable message when invalid.
 */
export function cleanReviewUrl(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (raw === "") return null;
  if (raw.length > 500) throw new Error("That link is too long.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a full web address starting with https://");
  }
  if (url.protocol !== "https:") throw new Error("The link must start with https://");
  if (url.username || url.password) throw new Error("The link must not contain a username or password.");
  return url.toString();
}

export function cleanComment(input: string | null | undefined): string | null {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return null;
  if (text.length > COMMENT_MAX) throw new Error(`Please keep the comment under ${COMMENT_MAX} characters.`);
  return text;
}

export interface DishRatingRow {
  menuItemId: string;
  name: string;
  /// Index 0 is one star, index 4 is five stars.
  distribution: [number, number, number, number, number];
}

export interface DishRatingLine {
  menuItemId: string;
  name: string;
  count: number;
  average: number;
  distribution: [number, number, number, number, number];
  /// Too few ratings to say much yet (guests see the stars only from DISH_RATING_MIN_COUNT ratings).
  few: boolean;
  /// Rated low enough, by enough guests, to look into.
  weak: boolean;
}

/** An average at or below this, from enough guests, marks a dish as weak. */
export const WEAK_DISH_AVERAGE = 3.5;

/** One line per rated dish, lowest average first (then the most rated), with flags for dishes with few ratings or weak ones. */
export function summarizeDishRatings(rows: DishRatingRow[]): DishRatingLine[] {
  return rows
    .map((r) => {
      const count = r.distribution.reduce((n, c) => n + c, 0);
      const total = r.distribution.reduce((n, c, i) => n + c * (i + 1), 0);
      const average = count ? Math.round((total / count) * 10) / 10 : 0;
      const few = count < DISH_RATING_MIN_COUNT;
      return { menuItemId: r.menuItemId, name: r.name, count, average, distribution: r.distribution, few, weak: !few && average <= WEAK_DISH_AVERAGE };
    })
    .filter((l) => l.count > 0)
    .sort((a, b) => a.average - b.average || b.count - a.count || a.name.localeCompare(b.name));
}
