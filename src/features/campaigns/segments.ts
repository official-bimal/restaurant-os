/**
 * Customer segments and message templates. Pure functions, no I/O.
 *
 * Segments are worked out from what the business already knows (visits, spend, last visit), so
 * no extra data is collected. The thresholds are plain numbers here and easy to change.
 */

export const SEGMENTS = ["NEW", "RETURNING", "REGULAR", "VIP", "AT_RISK", "LOST", "NO_VISIT"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_INFO: Record<Segment, { label: string; description: string }> = {
  NEW: { label: "New", description: "Came once, recently" },
  RETURNING: { label: "Returning", description: "2 to 4 visits, seen recently" },
  REGULAR: { label: "Regulars", description: "5 or more visits, seen recently" },
  VIP: { label: "VIPs", description: "High lifetime spend, seen recently" },
  AT_RISK: { label: "At risk", description: "Not seen for over 30 days" },
  LOST: { label: "Lost", description: "Not seen for over 90 days" },
  NO_VISIT: { label: "Not visited yet", description: "On file but no paid visit" },
};

export const AT_RISK_DAYS = 30;
export const LOST_DAYS = 90;
export const REGULAR_VISITS = 5;
/** Lifetime spend, in paisa, that makes someone a VIP (Rs 20,000). */
export const VIP_SPEND = 2_000_000;

export interface CustomerFacts {
  visitCount: number;
  totalSpend: number;
  lastVisitAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A customer is in exactly one segment. Lapsed guests come first, so a former VIP who vanished is "at risk". */
export function segmentOf(c: CustomerFacts, now: Date): Segment {
  if (c.visitCount <= 0 || !c.lastVisitAt) return "NO_VISIT";
  const days = Math.floor((now.getTime() - c.lastVisitAt.getTime()) / DAY_MS);
  if (days > LOST_DAYS) return "LOST";
  if (days > AT_RISK_DAYS) return "AT_RISK";
  if (c.totalSpend >= VIP_SPEND) return "VIP";
  if (c.visitCount >= REGULAR_VISITS) return "REGULAR";
  if (c.visitCount >= 2) return "RETURNING";
  return "NEW";
}

export function isSegment(value: string): value is Segment {
  return (SEGMENTS as readonly string[]).includes(value);
}

// --- templates ---------------------------------------------------------------

export const TEMPLATE_MAX = 320;
const PLACEHOLDERS = ["name", "points", "days", "business"] as const;

/** Throws a readable message for a template that is empty, too long, or uses an unknown {placeholder}. */
export function validateTemplate(template: string): string {
  const t = template.trim();
  if (t.length < 5) throw new Error("Write the message (at least a few words).");
  if (t.length > TEMPLATE_MAX) throw new Error(`Keep the message under ${TEMPLATE_MAX} characters so it fits in two texts.`);
  for (const m of t.matchAll(/\{([^}]*)\}/g)) {
    if (!(PLACEHOLDERS as readonly string[]).includes(m[1])) {
      throw new Error(`"{${m[1]}}" is not a known placeholder. Use {name}, {points}, {days} or {business}.`);
    }
  }
  if (/[{}]/.test(t.replace(/\{(name|points|days|business)\}/g, ""))) throw new Error("There is a stray { or } in the message.");
  return t;
}

/** First name only, or "there" when we do not know it, so a message never reads "Hi null". */
export function firstName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || "there";
}

export function renderTemplate(
  template: string,
  values: { name: string | null; points: number; days: number; business: string },
): string {
  // One pass over the template, so text that came from a value (a customer called "{business} Ltd")
  // is never itself expanded.
  const map: Record<string, string> = {
    name: firstName(values.name),
    points: String(values.points),
    days: String(values.days),
    business: values.business,
  };
  return template.replace(/\{(name|points|days|business)\}/g, (_m, key: string) => map[key]);
}
