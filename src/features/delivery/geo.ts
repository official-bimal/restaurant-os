/**
 * Locations and distances for delivery, pure and free of any outside service.
 * Distance is worked out from two points: straight-line distance stretched by a road factor, or the
 * real road distance if a routing server of your own is configured (see routeMeters).
 */

export interface Point {
  lat: number;
  lng: number;
}

const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const point = (lat: number, lng: number): Point | null => (valid(lat, lng) ? { lat, lng } : null);

const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";

/**
 * Reads a location typed or pasted by staff: "27.7172, 85.324", "27.7172 85.324", or a link copied from a
 * map app (Google Maps with @lat,lng or q=lat,lng or !3d..!4d, OpenStreetMap with mlat/mlon or #map=z/lat/lng,
 * or a geo: link). Short links (maps.app.goo.gl) cannot be read without visiting them, so they are refused.
 */
export function parseLocation(input: string | null | undefined): Point | null {
  const text = (input ?? "").trim();
  if (!text || text.length > 600) return null;

  let m = new RegExp(`^${NUM}\\s*[,;\\s]\\s*${NUM}$`).exec(text);
  if (m) return point(Number(m[1]), Number(m[2]));

  m = new RegExp(`^geo:${NUM},${NUM}`, "i").exec(text);
  if (m) return point(Number(m[1]), Number(m[2]));

  if (/^https?:\/\//i.test(text)) {
    const decoded = decodeURIComponent(text);
    const patterns: RegExp[] = [
      new RegExp(`!3d${NUM}!4d${NUM}`),
      new RegExp(`@${NUM},${NUM}`),
      new RegExp(`[?&](?:q|ll|query|destination)=${NUM}(?:,|\\+|%2C)${NUM}`),
      new RegExp(`mlat=${NUM}&mlon=${NUM}`),
      new RegExp(`#map=\\d+/${NUM}/${NUM}`),
    ];
    for (const p of patterns) {
      const hit = p.exec(decoded);
      if (hit) return point(Number(hit[1]), Number(hit[2]));
    }
  }
  return null;
}

/** Great-circle distance between two points, in metres. */
export function haversineMeters(a: Point, b: Point): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Straight-line distance stretched to a likely road distance (a factor of 130 means 30% longer). */
export function estimateRoadMeters(a: Point, b: Point, factorPct: number): number {
  const pct = Number.isFinite(factorPct) ? Math.min(300, Math.max(100, factorPct)) : 130;
  return Math.round((haversineMeters(a, b) * pct) / 100);
}

/**
 * Road distance from your own OSRM-compatible routing server, if ROUTING_URL is set. Only the two coordinate pairs
 * are sent (no address, name or phone). Returns null if it is not configured or does not answer in time, so the
 * caller falls back to the estimate.
 */
export async function routeMeters(a: Point, b: Point, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  const base = process.env.ROUTING_URL?.replace(/\/$/, "");
  if (!base) return null;
  try {
    const url = `${base}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(4_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { code?: string; routes?: { distance?: number }[] };
    const d = data.code === "Ok" ? data.routes?.[0]?.distance : undefined;
    return typeof d === "number" && Number.isFinite(d) && d > 0 ? Math.round(d) : null;
  } catch {
    return null;
  }
}

export async function distanceBetween(
  from: Point,
  to: Point,
  factorPct: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ meters: number; method: "route" | "estimate" }> {
  const route = await routeMeters(from, to, fetchImpl);
  if (route !== null) return { meters: route, method: "route" };
  return { meters: estimateRoadMeters(from, to, factorPct), method: "estimate" };
}

/** Where a point sits relative to a centre, for drawing a simple map without any map tiles: metres east and north. */
export function offsetMeters(centre: Point, p: Point): { east: number; north: number } {
  const north = haversineMeters(centre, { lat: p.lat, lng: centre.lng }) * (p.lat >= centre.lat ? 1 : -1);
  const east = haversineMeters(centre, { lat: centre.lat, lng: p.lng }) * (p.lng >= centre.lng ? 1 : -1);
  return { east, north };
}

/**
 * Places points on a flat drawing of the given size, keeping true proportions (north up), with padding.
 * Works for a few kilometres, which is all a delivery needs. Returns pixel positions in the same order and the
 * metres each pixel stands for, so a scale bar can be drawn.
 */
export function fitPoints(points: Point[], width: number, height: number, padding: number): { xy: { x: number; y: number }[]; metersPerPixel: number } {
  if (points.length === 0) return { xy: [], metersPerPixel: 1 };
  const centre = { lat: (Math.min(...points.map((p) => p.lat)) + Math.max(...points.map((p) => p.lat))) / 2, lng: (Math.min(...points.map((p) => p.lng)) + Math.max(...points.map((p) => p.lng))) / 2 };
  const off = points.map((p) => offsetMeters(centre, p));
  const spanE = Math.max(...off.map((o) => Math.abs(o.east)), 1) * 2;
  const spanN = Math.max(...off.map((o) => Math.abs(o.north)), 1) * 2;
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  // One scale for both axes; never zoom in past 50 m per pixel's worth of nothing (a single point sits in the middle).
  const metersPerPixel = Math.max(spanE / innerW, spanN / innerH, 1);
  return {
    xy: off.map((o) => ({ x: width / 2 + o.east / metersPerPixel, y: height / 2 - o.north / metersPerPixel })),
    metersPerPixel,
  };
}
