"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { allow } from "@/server/rate-limit";
import { DomainError } from "@/server/errors";
import { cancelOwnReservation, submitReservationRequest } from "@/features/reservations/server/service";

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{16,40}$/);

async function caller(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function reserveAction(token: string, formData: FormData) {
  const t = tokenSchema.parse(token);
  const back = `/o/${t}/reserve`;
  let code: string;
  try {
    if (!allow(`reserve:${await caller()}`, 6, 60 * 60_000)) throw new DomainError("Too many tries. Please wait a few minutes and try again.");
    const r = await submitReservationRequest(t, {
      name: String(formData.get("name") ?? "").slice(0, 100),
      phone: String(formData.get("phone") ?? "").slice(0, 40),
      partySize: Math.floor(Number(formData.get("partySize") || 0)),
      date: String(formData.get("date") ?? ""),
      time: String(formData.get("time") ?? ""),
      note: String(formData.get("note") ?? "").slice(0, 300),
    });
    code = r.token;
  } catch (e) {
    if (e instanceof DomainError) redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`${back}/${code}`);
}

export async function cancelReservationAction(token: string, code: string) {
  const t = tokenSchema.parse(token);
  const c = tokenSchema.parse(code);
  const back = `/o/${t}/reserve/${c}`;
  try {
    if (!allow(`reserve-cancel:${await caller()}`, 10, 60 * 60_000)) throw new DomainError("Too many tries. Please wait a few minutes.");
    await cancelOwnReservation(c);
  } catch (e) {
    if (e instanceof DomainError) redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(back);
}
