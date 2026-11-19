import { DomainError } from "@/server/errors";

/** Pure: checking and tidying the business profile form. */

export const MAX_LOGO_BYTES = 300_000;

export interface ProfileInput {
  name: string;
  legalName: string;
  panNumber: string;
  phone: string;
  email: string;
  address: string;
  businessType: string;
  openedOn: string;
  website: string;
  facebook: string;
  instagram: string;
}

export const BUSINESS_TYPES = ["Cafe", "Restaurant", "Hukka lounge", "Bar", "Bakery", "Food truck", "Hotel restaurant", "Other"] as const;

const clip = (v: string, max: number) => v.trim().replace(/\s+/g, " ").slice(0, max);
const empty = (v: string) => (v === "" ? null : v);

/** Social links keep only what comes after the site (a handle), or a full https link to the same kind of page. */
export function cleanLink(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    let u: URL;
    try {
      u = new URL(t);
    } catch {
      throw new DomainError("That link does not look right.");
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new DomainError("That link does not look right.");
    return u.toString().slice(0, 200);
  }
  if (/^[\w.\-/@]{1,80}$/.test(t)) return t.replace(/^@/, "");
  throw new DomainError("Use a web link or a short name such as nerrocafe.");
}

export function cleanProfile(i: ProfileInput) {
  const name = clip(i.name, 80);
  if (name.length < 2) throw new DomainError("The business needs a name.");
  const email = clip(i.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("That email does not look right.");
  const phone = clip(i.phone, 30);
  if (phone && !/^[0-9+\-() ]{6,30}$/.test(phone)) throw new DomainError("The phone number may only have digits, spaces, + - ( ).");
  const pan = clip(i.panNumber, 20);
  if (pan && !/^[0-9A-Za-z-]{5,20}$/.test(pan)) throw new DomainError("The PAN number does not look right.");
  const openedOn = i.openedOn.trim();
  if (openedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(openedOn) || Number.isNaN(Date.parse(`${openedOn}T00:00:00Z`)))) throw new DomainError("The opening date is not a real date.");
  const website = cleanLink(i.website);
  if (website && !/^https?:\/\//i.test(website)) throw new DomainError("The website must start with https://");
  return {
    name,
    legalName: empty(clip(i.legalName, 120)),
    panNumber: empty(pan),
    phone: empty(phone),
    email: empty(email),
    address: empty(clip(i.address, 200)),
    businessType: empty(clip(i.businessType, 40)),
    openedOn: empty(openedOn),
    website,
    facebook: cleanLink(i.facebook),
    instagram: cleanLink(i.instagram),
  };
}
