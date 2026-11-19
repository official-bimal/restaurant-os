/**
 * Wi-Fi for guests. The table QR page shows the network name and password, and a QR code in the standard Wi-Fi format
 * (`WIFI:T:WPA;S:name;P:password;;`) that a phone camera understands: scanning it offers to join the network.
 *
 * A web page cannot join a Wi-Fi network by itself (no phone allows it), so the page shows the details with a copy button, and the
 * QR code is for connecting another device by pointing its camera at it. Pure functions, no I/O.
 */

export const WIFI_SECURITY = ["WPA", "WEP", "nopass"] as const;
export type WifiSecurity = (typeof WIFI_SECURITY)[number];

export const WIFI_SECURITY_LABEL: Record<WifiSecurity, string> = {
  WPA: "WPA / WPA2 / WPA3 (most networks)",
  WEP: "WEP (old)",
  nopass: "No password (open)",
};

export interface WifiSettings {
  name: string;
  /** Empty for an open network. */
  password: string;
  security: WifiSecurity;
  hidden: boolean;
}

export class WifiError extends Error {}

const bytes = (s: string) => new TextEncoder().encode(s).length;

/**
 * Checks what the owner typed. A blank name means "no Wi-Fi to show" and gives null. Otherwise returns clean settings or throws a
 * readable WifiError. The limits are the real Wi-Fi limits: a network name is at most 32 bytes, a WPA password 8 to 63 characters.
 */
export function cleanWifi(raw: { name: string; password: string; security: string; hidden: boolean }): WifiSettings | null {
  const name = raw.name.replace(/\p{Cc}/gu, "").trim();
  if (!name) return null;
  if (bytes(name) > 32) throw new WifiError("A Wi-Fi network name can be at most 32 characters.");
  const security = (WIFI_SECURITY as readonly string[]).includes(raw.security) ? (raw.security as WifiSecurity) : null;
  if (!security) throw new WifiError("Choose how the network is secured.");
  // Spaces inside a password are real; only control characters are dropped, and the ends are kept as typed.
  const password = raw.password.replace(/\p{Cc}/gu, "");
  if (security === "nopass") return { name, password: "", security, hidden: raw.hidden };
  if (security === "WPA" && !(password.length >= 8 && password.length <= 63) && !/^[0-9a-fA-F]{64}$/.test(password)) {
    throw new WifiError("A WPA password must be 8 to 63 characters.");
  }
  if (security === "WEP" && (password.length < 5 || password.length > 26)) throw new WifiError("A WEP password must be 5 to 26 characters.");
  return { name, password, security, hidden: raw.hidden };
}

/** Escapes the characters that have a meaning in the Wi-Fi QR format: \ ; , : and ". */
function escapeField(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/** A value that could be mistaken for hexadecimal must be wrapped in quotes, or some phones read it as hex digits. */
function field(value: string): string {
  const escaped = escapeField(value);
  return /^[0-9a-fA-F]+$/.test(value) ? `"${escaped}"` : escaped;
}

/** The text to put in the QR code. */
export function wifiQrPayload(w: WifiSettings): string {
  const parts = [`T:${w.security}`, `S:${field(w.name)}`];
  if (w.security !== "nopass") parts.push(`P:${field(w.password)}`);
  if (w.hidden) parts.push("H:true");
  return `WIFI:${parts.join(";")};;`;
}
