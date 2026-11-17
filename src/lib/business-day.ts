/**
 * Business-day maths. Pure functions, no I/O.
 *
 * A "day" is a calendar date in the business's own time zone, written YYYY-MM-DD. Orders and
 * payments are stored as UTC instants, so a Kathmandu cafe's Monday runs from Sunday 18:15 UTC
 * to Monday 18:15 UTC. Getting this wrong is what makes software say "Yesterday" for today.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** The business's calendar date for an instant. */
export function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Minutes the zone is ahead of UTC at an instant (Kathmandu: 345). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The UTC instant of local midnight at the start of `date`. */
function startOfLocalDay(date: string, timeZone: string): Date {
  const m = DATE_RE.exec(date);
  if (!m || !isValidDate(date)) throw new RangeError("Not a valid date");
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let t = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  // Across a daylight-saving change the first guess can be an hour out; settle it.
  t = guess - offsetMinutes(new Date(t), timeZone) * 60_000;
  return new Date(t);
}

export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError("Not a valid date");
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** [start, end) of the business day, as UTC instants. A day can be 23 or 25 hours long where clocks change. */
export function dayRange(date: string, timeZone: string): { start: Date; end: Date } {
  return { start: startOfLocalDay(date, timeZone), end: startOfLocalDay(addDays(date, 1), timeZone) };
}
