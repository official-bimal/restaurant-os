import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts a secret we must be able to send again later (such as another system's API key) with AES-256-GCM, using a key
 * derived from SESSION_SECRET. A stored value is "v1.<iv>.<tag>.<ciphertext>" in base64url. Anyone who can read the database
 * but not the server's environment cannot read the secret; changing SESSION_SECRET makes stored secrets unreadable, which
 * shows up as "enter the key again" rather than a wrong answer (GCM authenticates).
 */

function key(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return createHash("sha256").update(`secretbox:v1:${s}`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** The secret, or null if the value is damaged or was sealed under a different SESSION_SECRET. */
export function unseal(sealed: string): string | null {
  try {
    const [v, iv, tag, body] = sealed.split(".");
    if (v !== "v1" || !iv || !tag || !body) return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
