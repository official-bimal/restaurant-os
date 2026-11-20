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

/** Whether a table has room for the party. */
export function fits(capacity: number, partySize: number): boolean {
  return capacity >= partySize;
}

export interface BookedTable {
  id: string;
  tableId: string;
  date: string;
  time: string;
  name: string;
}

export interface TableChoice {
  id: string;
  label: string;
  capacity: number;
  /** Room for the whole party. */
  fits: boolean;
  /** Not held for anyone else around this time. */
  free: boolean;
  /** Who holds it, when it is not free. */
  heldBy?: string;
  heldAt?: string;
}

/** For one booking: each table, whether it is big enough and whether it is free at that time (the booking's own hold does not count against it). */
export function tableChoices(
  tables: { id: string; label: string; capacity: number }[],
  booked: BookedTable[],
  r: { id: string; date: string; time: string; partySize: number },
): TableChoice[] {
  return tables.map((t) => {
    const other = booked.find((b) => b.tableId === t.id && b.id !== r.id && clash(r, b));
    return { id: t.id, label: t.label, capacity: t.capacity, fits: fits(t.capacity, r.partySize), free: !other, ...(other ? { heldBy: other.name, heldAt: other.time } : {}) };
  });
}

/** The table to give a party by default: free, big enough, and the smallest such table, so big tables stay for big parties. The list order breaks ties. */
export function bestTable(choices: TableChoice[]): TableChoice | null {
  let best: TableChoice | null = null;
  for (const c of choices) if (c.free && c.fits && (!best || c.capacity < best.capacity)) best = c;
  return best;
}

export type FloorState = "later" | "soon" | "due" | "late";

export interface FloorReservation {
  id: string;
  tableId: string;
  name: string;
  partySize: number;
  time: string;
  state: FloorState;
  /** Minutes until the booking (negative once the time has passed). */
  minutesUntil: number;
}

/** A booking that is this close (minutes) is shown as "soon", and one this far past its time as "late". */
export const SOON_MINUTES = 60;
export const DUE_MINUTES = 15;

/**
 * What the floor map says about each table today: the next booking that still matters. Bookings already seated or cancelled are not
 * shown, and neither is one that is long past its time (the hold has run out). When a table has several, the earliest one that still
 * counts is shown.
 */
export function floorReservations(
  rows: { id: string; tableId: string | null; name: string; partySize: number; time: string; status: ReservationStatus }[],
  nowMinute: number,
): Map<string, FloorReservation> {
  const out = new Map<string, FloorReservation>();
  const live = rows
    .filter((r): r is typeof r & { tableId: string } => r.status === "CONFIRMED" && !!r.tableId)
    .map((r) => ({ r, minutesUntil: toMinutes(r.time) - nowMinute }))
    .filter((x) => x.minutesUntil > -HOLD_MINUTES)
    .sort((a, b) => a.minutesUntil - b.minutesUntil);
  for (const { r, minutesUntil } of live) {
    if (out.has(r.tableId)) continue;
    const state: FloorState = minutesUntil > SOON_MINUTES ? "later" : minutesUntil > DUE_MINUTES ? "soon" : minutesUntil >= -DUE_MINUTES ? "due" : "late";
    out.set(r.tableId, { id: r.id, tableId: r.tableId, name: r.name, partySize: r.partySize, time: r.time, state, minutesUntil });
  }
  return out;
}

/** A short line for a table's tile: "Reserved 19:30 · Sita ×4". */
export function reservedLine(f: Pick<FloorReservation, "time" | "name" | "partySize" | "state">): string {
  const who = `${f.name.trim().split(" ")[0]} ×${f.partySize}`;
  return f.state === "late" ? `Late: ${f.time} · ${who}` : `Reserved ${f.time} · ${who}`;
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
