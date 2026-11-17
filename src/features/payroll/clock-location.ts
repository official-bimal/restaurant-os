import { haversineMeters } from "@/features/delivery/geo";

/**
 * Is a phone at the branch? Pure checks used when staff clock in or out. The phone reports a point and how sure it is
 * (accuracy, in metres); the branch has a point and a radius.
 *
 * Honest limit: this proves where the phone says it is. A phone can be made to report a false location, so treat it as a
 * strong nudge against clocking in from home, not as proof against someone determined to cheat.
 */

export interface ClockLocation {
  lat: number;
  lng: number;
  /** Metres: the phone's own estimate of how far off it might be. */
  accuracy: number;
}

/** A reading less accurate than this is not trusted (indoors with no GPS, a phone guessing from the network). */
export const MAX_ACCURACY_M = 150;
export const MIN_RADIUS_M = 30;
export const MAX_RADIUS_M = 1000;

export function parseClockLocation(input: unknown): ClockLocation | null {
  if (!input || typeof input !== "object") return null;
  const { lat, lng, accuracy } = input as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lng !== "number" || typeof accuracy !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracy)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || accuracy < 0) return null;
  return { lat, lng, accuracy };
}

export type ClockCheck = { ok: true; distance: number } | { ok: false; reason: string };

export interface BranchPoint {
  name: string;
  latitude: number | null;
  longitude: number | null;
  radius: number;
}

/** Distance from the branch in metres, or null when the branch has no location or no reading was given. */
export function distanceFromBranch(branch: BranchPoint, loc: ClockLocation | null): number | null {
  if (!loc || branch.latitude === null || branch.longitude === null) return null;
  return haversineMeters({ lat: branch.latitude, lng: branch.longitude }, { lat: loc.lat, lng: loc.lng });
}

/** The rule for clocking IN where location is required. */
export function checkClockIn(branch: BranchPoint, loc: ClockLocation | null): ClockCheck {
  if (branch.latitude === null || branch.longitude === null) {
    return { ok: false, reason: `${branch.name} has no location yet. Ask the owner to set it on the Branches page.` };
  }
  if (!loc) return { ok: false, reason: "Allow location on your phone to clock in. It is only checked at the moment you tap." };
  if (loc.accuracy > MAX_ACCURACY_M) {
    return { ok: false, reason: `Your phone's location is not exact enough (about ${Math.round(loc.accuracy)} m off). Turn on GPS, step near a window or outside, and try again.` };
  }
  const distance = distanceFromBranch(branch, loc)!;
  if (distance > branch.radius) {
    return { ok: false, reason: `You are about ${distance} m from ${branch.name}. Clock in when you are at the cafe (within ${branch.radius} m).` };
  }
  return { ok: true, distance };
}

export function clampRadius(value: number): number {
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(value)));
}
