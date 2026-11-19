/**
 * Hukka (shisha) timing. Pure functions, no I/O.
 */

/** A category whose dishes are timed: its name mentions hukka, hookah or shisha. */
export function isHukkaCategory(name: string): boolean {
  return /hukk?a|hookah|shisha/i.test(name);
}

/** The extra-coil dish: not a hukka itself, so it is billed but not timed. */
export function isCoilDish(name: string): boolean {
  return /\bcoil\b|\bcoal\b/i.test(name);
}

export function minutesSince(start: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 60_000));
}

export type HukkaState = "FRESH" | "LATE_SOON" | "RUNNING_LONG";

/** Running long once it passes the alert time; "late soon" in the last tenth of it, so the waiter can offer a coil or the bill. */
export function hukkaState(elapsedMinutes: number, alertMinutes: number): HukkaState {
  if (elapsedMinutes >= alertMinutes) return "RUNNING_LONG";
  if (elapsedMinutes >= alertMinutes - Math.max(5, Math.round(alertMinutes / 10))) return "LATE_SOON";
  return "FRESH";
}

export function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}
