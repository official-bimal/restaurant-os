/**
 * Menu sets and schedules, pure. A "set" is a named part of the menu (Breakfast, Lunch).
 * A set can be switched on by hand, or follow a weekly schedule; with neither, the whole menu shows.
 */

export interface ScheduleRow {
  menuSetId: string;
  /** 0 = Sunday ... 6 = Saturday. */
  dayOfWeek: number;
  /** Minutes after midnight; end is exclusive. */
  startMinute: number;
  endMinute: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The weekday and minute of day at `instant` in the business's own time zone. */
export function localParts(instant: Date, timeZone: string): { dayOfWeek: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { dayOfWeek: WEEKDAYS.indexOf(get("weekday")), minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Which set applies right now: the hand-picked one wins, then the first matching schedule, else none (whole menu). */
export function pickActiveSet(
  manualId: string | null,
  schedules: ScheduleRow[],
  now: { dayOfWeek: number; minute: number },
): string | null {
  if (manualId) return manualId;
  const hit = schedules.find((s) => s.dayOfWeek === now.dayOfWeek && now.minute >= s.startMinute && now.minute < s.endMinute);
  return hit?.menuSetId ?? null;
}

/** "07:30" to minutes after midnight, or null if it is not a valid time. */
export function parseTime(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
