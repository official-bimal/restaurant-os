import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { DomainError } from "@/server/errors";

/** Nepal by default: guests type 98XXXXXXXX without a country code. */
const DEFAULT_REGION = "NP";

/** Normalise any reasonable phone input to E.164 (+9779812345678), or throw a readable error. */
export function normalizePhone(input: string): string {
  const raw = input.trim();
  if (raw.length === 0 || raw.length > 30) throw new DomainError("Enter a valid phone number.");
  const parsed = parsePhoneNumberFromString(raw, DEFAULT_REGION);
  if (!parsed || !parsed.isValid()) throw new DomainError("Enter a valid phone number.");
  return parsed.number; // E.164
}

/** Hide the middle for display to anyone who is not staff: +977 98••••••78. */
export function maskPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return "••••••";
  const national = parsed.nationalNumber;
  const shown = national.length > 4 ? `${national.slice(0, 2)}${"•".repeat(national.length - 4)}${national.slice(-2)}` : "••••";
  return `+${parsed.countryCallingCode} ${shown}`;
}
