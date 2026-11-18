import { db } from "@/server/db";
import type { Tx } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { distanceBetween, parseLocation, type Point } from "../geo";
import { geocodeAddress, phoneKey } from "../geocode";
import { feeForDistance, formatKm, kmToMeters } from "@/features/orders/server/delivery";

/**
 * Where a delivery goes and what it costs. Shared by staff-made delivery orders and by online orders, so both are priced by the same
 * rules: by distance when the branch has distance bands, else by the zone chosen, else free.
 */

export interface Located {
  dest: Point;
  /** Road distance from the branch, when the branch has a location. */
  meters: number | null;
}

/**
 * Works out where the address is, in order of trust: a location typed or pasted (coordinates or a map link), then a place remembered
 * for this phone number (only when the address is the same words), then (only if a geocoding server is set up) a lookup of the address
 * text. Done before any transaction because a routing server, if one is set up, is a network call.
 */
export async function locateDestination(p: { businessId: string; branchId: string; address: string; phone: string; location?: string }): Promise<Located | null> {
  const { businessId, branchId } = p;
  let dest: Point | null = null;
  if (p.location?.trim()) {
    dest = parseLocation(p.location);
    if (!dest) throw new DomainError("Could not read that location. Paste coordinates like 27.7172, 85.324 or a link from a map app.");
  } else {
    const key = phoneKey(p.phone);
    const saved = key ? await db.deliveryPlace.findUnique({ where: { businessId_phoneKey: { businessId, phoneKey: key } } }) : null;
    // A customer who moved is not sent to the old place: it is only reused for the same address.
    if (saved && saved.address.toLowerCase() === p.address.toLowerCase()) dest = { lat: saved.lat, lng: saved.lng };
    else dest = await geocodeAddress(p.address);
  }
  if (!dest) return null;
  const [branch, business] = await Promise.all([
    db.branch.findUnique({ where: { businessId_id: { businessId, id: branchId } }, select: { latitude: true, longitude: true } }),
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { roadFactorPct: true } }),
  ]);
  const from = branch?.latitude != null && branch.longitude != null ? { lat: branch.latitude, lng: branch.longitude } : null;
  return { dest, meters: from ? (await distanceBetween(from, dest, business.roadFactorPct)).meters : null };
}

export interface FeeQuote {
  name: string;
  fee: number;
  meters?: number;
}

/**
 * The delivery fee: by distance when the branch has distance bands (from the location when there is one, else the distance typed),
 * else by the zone chosen, else null (free). Throws a readable error when the address is outside the range or no area was chosen.
 */
export async function quoteDeliveryFee(
  client: Tx | typeof db,
  p: { businessId: string; branchId: string; located: Located | null; distanceKm?: number | string; zoneId?: string },
): Promise<FeeQuote | null> {
  const { businessId, branchId } = p;
  let quote: FeeQuote | null = null;
  const bands = await client.deliveryBand.findMany({ where: { businessId, branchId, active: true } });
  if (bands.length > 0) {
    const meters = p.located?.meters ?? kmToMeters(p.distanceKm);
    const hit = feeForDistance(bands, meters);
    if (!hit) {
      const max = Math.max(...bands.map((b) => b.upToMeters));
      throw new DomainError(`That address is outside the delivery range (up to ${formatKm(max)}).`);
    }
    quote = { name: `Up to ${formatKm(hit.upToMeters)}`, fee: hit.fee, meters };
  }
  const zones = bands.length > 0 ? [] : await client.deliveryZone.findMany({ where: { businessId, branchId, active: true } });
  if (zones.length > 0) {
    const picked = zones.find((z) => z.id === p.zoneId);
    if (!picked) throw new DomainError("Choose the delivery area.");
    quote = { name: picked.name, fee: picked.fee };
  }
  return quote;
}

/** Remember where this customer was delivered to, so the next order to the same address needs no lookup. Never fails the order. */
export function rememberPlace(p: { businessId: string; phone: string; address: string; located: Located | null }): void {
  const key = phoneKey(p.phone);
  if (!key || !p.located) return;
  void db.deliveryPlace
    .upsert({
      where: { businessId_phoneKey: { businessId: p.businessId, phoneKey: key } },
      create: { businessId: p.businessId, phoneKey: key, address: p.address, lat: p.located.dest.lat, lng: p.located.dest.lng },
      update: { address: p.address, lat: p.located.dest.lat, lng: p.located.dest.lng },
    })
    .catch(() => {});
}
