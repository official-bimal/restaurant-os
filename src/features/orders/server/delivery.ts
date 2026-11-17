import { DomainError } from "@/server/errors";

/** Delivery details and the allowed steps, pure so they can be tested without a database. */

export interface DeliveryInput {
  name?: string;
  phone?: string;
  address?: string;
  /** Where to deliver: coordinates or a pasted map link. Gives the distance automatically and a point for the map. */
  location?: string;
}

export function cleanDelivery(input: DeliveryInput | undefined): { name: string | null; phone: string; address: string } {
  const name = (input?.name ?? "").trim().replace(/\s+/g, " ");
  const phone = (input?.phone ?? "").trim();
  const address = (input?.address ?? "").trim().replace(/\s+/g, " ");
  const digits = phone.replace(/\D/g, "");
  if (name.length > 80) throw new DomainError("The name is too long (80 characters at most).");
  if (digits.length < 7 || digits.length > 15 || !/^[+\d\s()-]+$/.test(phone)) {
    throw new DomainError("Enter a phone number the rider can call.");
  }
  if (address.length < 5) throw new DomainError("Enter the delivery address.");
  if (address.length > 200) throw new DomainError("The address is too long (200 characters at most).");
  return { name: name || null, phone, address };
}

export type DeliveryStep = "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED";

const NEXT: Record<DeliveryStep, DeliveryStep[]> = {
  PREPARING: ["OUT_FOR_DELIVERY", "FAILED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "FAILED"],
  DELIVERED: [],
  FAILED: [],
};

export function canMoveDelivery(from: DeliveryStep, to: DeliveryStep): boolean {
  return NEXT[from].includes(to);
}

export interface FeeBand {
  upToMeters: number;
  fee: number;
}

/**
 * The fee for a distance: the first band that reaches it (bands are "up to N km"). A distance beyond the
 * last band is outside the delivery range, which is returned as null so the caller can refuse it.
 */
export function feeForDistance(bands: FeeBand[], meters: number): { fee: number; upToMeters: number } | null {
  const sorted = [...bands].sort((a, b) => a.upToMeters - b.upToMeters);
  const hit = sorted.find((b) => meters <= b.upToMeters);
  return hit ? { fee: hit.fee, upToMeters: hit.upToMeters } : null;
}

/** Kilometres typed by staff (like 2.5) to whole metres; rejects anything that is not a sensible distance. */
export function kmToMeters(km: unknown): number {
  const n = typeof km === "number" ? km : Number(km);
  if (!Number.isFinite(n) || n <= 0 || n > 200) throw new DomainError("Enter the delivery distance in km, for example 2.5.");
  return Math.round(n * 1000);
}

export const formatKm = (meters: number) => `${+(meters / 1000).toFixed(2)} km`;
