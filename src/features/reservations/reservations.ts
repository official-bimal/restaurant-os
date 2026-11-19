/**
 * Table reservations. Pure functions, no I/O.
 */
import { addDays, isValidDate } from "@/lib/business-day";

export const MAX_PARTY = 20;
export const MAX_DAYS_AHEAD = 60;
/** A table is held for this long around a booking, so two bookings at one table cannot overlap. */
export const HOLD_MINUTES = 90;

export type ReservationStatus = "REQUESTED" | "CONFIRMED" | "SEATED" | "CANCELLED" | "NO_SHOW";

const NEXT: Record<ReservationStatus, ReservationStatus[]> = {
  REQUESTED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["SEATED", "CANCELLED", "NO_SHOW"],
  SEATED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canMove(from: ReservationStatus, to: ReservationStatus): boolean {
  return NEXT[from].includes(to);
}

export function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

export function toMinutes(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

export interface BookingInput {
  name: string;
  partySize: number;
  date: string;
  time: string;
}

/** Why a booking cannot be made, or null. `today` and `nowMinute` are the branch's own date and minute of the day. */
export function bookingProblem(b: BookingInput, today: string, nowMinute: number): string | null {
  const name = b.name.trim();
  if (name.length < 1 || name.length > 60) return "Enter a name (60 letters at most).";
  if (!Number.isInteger(b.partySize) || b.partySize < 1 || b.partySize > MAX_PARTY) return `For a group of more than ${MAX_PARTY}, please call us.`;
  if (!isValidDate(b.date)) return "Choose a date.";
  if (!isValidTime(b.time)) return "Choose a time.";
  if (b.date < today) return "That day has passed.";
  if (b.date > addDays(today, MAX_DAYS_AHEAD)) return `Bookings open up to ${MAX_DAYS_AHEAD} days ahead.`;
  if (b.date === today && toMinutes(b.time) <= nowMinute) return "That time has passed.";
  return null;
}

/** Whether two bookings at the same table are too close together. */
export function clash(a: { date: string; time: string }, b: { date: string; time: string }): boolean {
  return a.date === b.date && Math.abs(toMinutes(a.time) - toMinutes(b.time)) < HOLD_MINUTES;
}

/** The message sent to a guest when a booking is confirmed. */
export function confirmationText(r: { name: string; partySize: number; date: string; time: string }, businessName: string): string {
  return `Hi ${r.name.trim().split(" ")[0]}, your table for ${r.partySize} at ${businessName} is confirmed for ${r.date} at ${r.time}. We hold it for 15 minutes. To change it, please call us.`;
}

export function declineText(r: { name: string; date: string; time: string }, businessName: string): string {
  return `Hi ${r.name.trim().split(" ")[0]}, sorry, we cannot take your booking for ${r.date} at ${r.time} at ${businessName}. Please call us to find another time.`;
}

/** A WhatsApp link that opens a chat with the guest and the message ready to send. `e164` like +9779841234567. */
export function whatsappLink(e164: string, text: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
