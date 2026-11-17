/**
 * The product's public name and wording, in one place so the name can be changed everywhere at once. The landing page,
 * the sign-in page and the install name all read from here (the app's own pages still say "Restaurant OS": search for it
 * when you pick a final name).
 */
export const BRAND = {
  name: "Restaurant OS",
  initial: "R",
  tagline: "Run your whole restaurant from one simple screen",
  /** Shown as an optional "Contact us" button on the landing page. Set NEXT_PUBLIC_CONTACT_EMAIL to turn it on. */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "",
};
