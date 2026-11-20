"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { createReservation, seatReservation, setReservationStatus, setReservationTable, setReservationsEnabled } from "@/features/reservations/server/service";

const id = z.string().min(1).max(60);
const STATUS = z.enum(["CONFIRMED", "CANCELLED", "SEATED", "NO_SHOW"]);

function back(date: string, extra = ""): never {
  revalidatePath("/reservations");
  redirect(`/reservations?date=${encodeURIComponent(date)}${extra}`);
}

export async function createReservationAction(formData: FormData) {
  const ctx = await requireTenant();
  const date = String(formData.get("date") ?? "");
  await guarded(`/reservations?date=${date}`, () =>
    createReservation(ctx, {
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      partySize: Math.floor(Number(formData.get("partySize") || 0)),
      date,
      time: String(formData.get("time") ?? ""),
      tableId: String(formData.get("tableId") ?? "") || undefined,
      note: String(formData.get("note") ?? ""),
    }),
  );
  back(date);
}

export async function reservationStatusAction(reservationId: string, status: string, date: string, formData: FormData) {
  const ctx = await requireTenant();
  const to = STATUS.parse(status);
  const r = await guarded(`/reservations?date=${date}`, () => setReservationStatus(ctx, id.parse(reservationId), to, { tableId: String(formData.get("tableId") ?? "") || undefined }));
  back(date, `&sms=${r.sms}${r.message ? `&smsError=${encodeURIComponent(r.message)}` : ""}`);
}

/** The party has arrived: start their order on the table and go straight to it. */
export async function seatReservationAction(reservationId: string, date: string, formData: FormData) {
  const ctx = await requireTenant();
  const seated = await guarded(`/reservations?date=${date}`, () => seatReservation(ctx, id.parse(reservationId), String(formData.get("tableId") ?? "") || undefined));
  revalidatePath("/reservations");
  revalidatePath("/orders");
  redirect(`/orders/${seated.orderId}`);
}

export async function reservationTableAction(reservationId: string, date: string, formData: FormData) {
  const ctx = await requireTenant();
  await guarded(`/reservations?date=${date}`, () => setReservationTable(ctx, id.parse(reservationId), String(formData.get("tableId") ?? "") || null));
  back(date);
}

export async function reservationsOpenAction(enabled: boolean, date: string) {
  const ctx = await requireTenant();
  await guarded(`/reservations?date=${date}`, () => setReservationsEnabled(ctx, enabled));
  back(date);
}
