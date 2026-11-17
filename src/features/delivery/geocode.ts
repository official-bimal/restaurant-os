import type { Point } from "./geo";

/**
 * Turning a typed street address into a location, with a geocoding server of your own (or one you choose and trust).
 * It is OFF unless GEOCODER_URL is set. When on, the address text is sent to that server and nothing else: no name or
 * phone. The server must speak the Nominatim search format (`/search?q=...&format=jsonv2`). GEOCODER_COUNTRY (for
 * example "np") can limit results to one country. Public servers have usage limits and policies, so for real use run
 * your own. Answers that are not a clear single place are ignored.
 */
export async function geocodeAddress(address: string, fetchImpl: typeof fetch = fetch): Promise<Point | null> {
  const base = process.env.GEOCODER_URL?.replace(/\/$/, "");
  const text = address.trim();
  if (!base || text.length < 5 || text.length > 300) return null;
  try {
    const params = new URLSearchParams({ q: text, format: "jsonv2", limit: "1", addressdetails: "0" });
    if (process.env.GEOCODER_COUNTRY) params.set("countrycodes", process.env.GEOCODER_COUNTRY);
    const res = await fetchImpl(`${base}/search?${params.toString()}`, {
      signal: AbortSignal.timeout(4_000),
      headers: { "User-Agent": "restaurant-os-delivery/1.0", Accept: "application/json" },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { lat?: string; lon?: string }[];
    const first = Array.isArray(rows) ? rows[0] : undefined;
    const lat = Number(first?.lat);
    const lng = Number(first?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/** The digits of a phone number: the key for remembering where a customer lives. Short or very long numbers are not used. */
export function phoneKey(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  // Compare on the last ten digits so +977 98..., 0098..., and 98... are the same person.
  return digits.slice(-10);
}
