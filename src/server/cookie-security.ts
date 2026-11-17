/**
 * Whether cookies should carry the "Secure" flag (sent only over https).
 *
 * In production it follows the address the app is served at (APP_URL): https means Secure, plain http does not. That
 * matters when the app is hosted on a local network over http (for example a phone opening http://192.168.1.10:3000):
 * a Secure cookie would never be stored there and nobody could sign in. With no APP_URL set in production it stays
 * Secure, the safe default. Outside production it is never Secure, so local development works.
 */
export function cookiesSecure(env: { NODE_ENV?: string; APP_URL?: string } = process.env): boolean {
  if (env.NODE_ENV !== "production") return false;
  const url = (env.APP_URL ?? "").trim().toLowerCase();
  if (!url) return true;
  return url.startsWith("https://");
}
