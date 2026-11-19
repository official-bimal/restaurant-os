/**
 * How the customer's phone reaches this server: APP_URL when it is set, otherwise the address the request came in on. A payment service sends
 * the customer's browser back to this address, so it must be one their phone can open (on the shop Wi-Fi, the shop PC's address works).
 */
export function baseUrlFrom(h: { get(name: string): string | null }): string {
  const fixed = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (fixed) return fixed;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
