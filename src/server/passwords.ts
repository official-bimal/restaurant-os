import { randomInt } from "node:crypto";
import { DomainError } from "@/server/errors";

export const MIN_PASSWORD_LENGTH = 10;

// No 0/O, 1/l/I: staff read these aloud or copy them from a phone screen.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** 12 random characters, about 68 bits. Shown once to the admin, then forced to change. */
export function generateTempPassword(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Throws a DomainError with a readable message when the password is not acceptable. */
export function assertAcceptablePassword(password: string, email: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > 200) throw new DomainError("That password is too long.");
  if (password.toLowerCase() === email.toLowerCase()) {
    throw new DomainError("The password cannot be the same as the email.");
  }
  if (/^(.)\1+$/.test(password)) throw new DomainError("Choose a less repetitive password.");
}
