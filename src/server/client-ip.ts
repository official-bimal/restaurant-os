import { isIP } from "node:net";

/**
 * The visitor's IP address, or null when it cannot be known safely.
 *
 * X-Forwarded-For is only trustworthy for the part added by proxies we control; anything
 * the visitor sends themselves is at the front. So we count `hops` entries from the END
 * (set TRUSTED_PROXY_HOPS to the number of proxies in front of the app, e.g. 1 behind a
 * single load balancer). With 0 hops (the default) the header is ignored entirely.
 */
export function clientIpFromHeaders(headers: Pick<Headers, "get">, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0)): string | null {
  if (!Number.isInteger(hops) || hops <= 0) return null;
  const raw = headers.get("x-forwarded-for");
  if (!raw) return null;
  const parts = raw.split(",").map((p) => p.trim());
  const candidate = parts[parts.length - hops];
  return candidate && isIP(candidate) ? candidate : null;
}
