import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless signed session token: base64url(payload).base64url(hmac).
 * The payload only identifies the user. The business and role are always
 * re-read from the database on each request (see auth.ts), never trusted
 * from the cookie or the browser.
 */
export const SESSION_COOKIE = "ros_session";
/** Which branch the staff member is working in. Only a hint: access is re-checked against the database. */
export const BRANCH_COOKIE = "ros_branch";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

interface SessionPayload {
  uid: string;
  /** User.sessionVersion at sign-in; a password change bumps it and ends this session. */
  sv: number;
  exp: number; // unix seconds
}

export interface SessionClaims {
  userId: string;
  sessionVersion: number;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return s;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createSessionToken(userId: string, sessionVersion: number, now = Date.now()): string {
  const payload: SessionPayload = {
    uid: userId,
    sv: sessionVersion,
    exp: Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Returns the claims, or null for any invalid, tampered or expired token. */
export function verifySessionToken(token: string | undefined, now = Date.now()): SessionClaims | null {
  if (!token) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (!Number.isInteger(payload.sv)) return null;
    if (payload.exp * 1000 <= now) return null;
    return { userId: payload.uid, sessionVersion: payload.sv };
  } catch {
    return null;
  }
}

// --- guest (QR) sessions ----------------------------------------------------
// A guest has no account. Their cookie names one open TableSession at one table.
// The table, business and whether the sitting is still open are always re-read
// from the database, so closing the session at checkout kills the cookie.

export const GUEST_COOKIE = "ros_guest";
export const GUEST_MAX_AGE_SECONDS = 60 * 60 * 6;

export interface GuestClaims {
  sessionId: string;
  tableId: string;
}

export function createGuestToken(claims: GuestClaims, now = Date.now()): string {
  const payload = { sid: claims.sessionId, tid: claims.tableId, exp: Math.floor(now / 1000) + GUEST_MAX_AGE_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `g.${body}.${sign(`g.${body}`)}`;
}

export function verifyGuestToken(token: string | undefined, now = Date.now()): GuestClaims | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "g") return null;
  const [, body, sig] = parts;
  const expected = Buffer.from(sign(`g.${body}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { sid?: unknown; tid?: unknown; exp?: unknown };
    if (typeof p.sid !== "string" || typeof p.tid !== "string" || typeof p.exp !== "number") return null;
    if (p.exp * 1000 <= now) return null;
    return { sessionId: p.sid, tableId: p.tid };
  } catch {
    return null;
  }
}
