/**
 * A random key for "make this action safe to repeat". Does not use crypto.randomUUID, which browsers only provide on
 * secure pages (https or localhost): on a plain-http local network address it does not exist and the guest page would
 * fail to load. getRandomValues works everywhere. The result is 32 hex characters, which the server accepts.
 */
export function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
