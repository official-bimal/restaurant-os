import { DomainError } from "@/server/errors";

/**
 * Pure: what the customer-facing screen shows, and checking what the till and the owner send it. The screen is simple: nothing when it is
 * switched off, a welcome when nobody is being served, the bill as it is built, the payment QR, and a thank-you after payment.
 */

/** The till checks in while an order is open; a screen not updated for this long goes back to the welcome. */
export const STALE_SECONDS = 60;

export const DEFAULT_WELCOME_TITLE = "Welcome";
export const DEFAULT_WELCOME_TEXT = "Your bill will appear here as it is made.";
export const DEFAULT_THANKS = "Thank you! Please come again.";

export type ScreenKind = "OFF" | "IDLE" | "BILL" | "PAY" | "PAID" | "THANKS";
export type QrKind = "none" | "static" | "intent";

export interface DecideInput {
  enabled: boolean;
  now: Date;
  /** The order the till is pointing at, or null. */
  orderId: string | null;
  followedAt: Date | null;
  order: null | { status: string; invoiceAt: Date | null; hasLines: boolean };
  /** The newest payment started for the order that is still open (not cancelled, failed or used). */
  intent: null | { status: string };
  hasStaticQr: boolean;
  showQr: boolean;
  autoQr: boolean;
  thanksSeconds: number;
}

/** Which screen to show, and which QR (if any) goes with it. */
export function decideScreen(i: DecideInput): { kind: ScreenKind; qr: QrKind } {
  if (!i.enabled) return { kind: "OFF", qr: "none" };
  const idle = { kind: "IDLE" as const, qr: "none" as const };
  if (!i.orderId || !i.order) return idle;
  // A paid bill shows its thank-you for a short while whether or not the till is still checking in; then the welcome.
  if (i.order.invoiceAt) {
    const age = (i.now.getTime() - i.order.invoiceAt.getTime()) / 1000;
    return age >= 0 && age < i.thanksSeconds ? { kind: "THANKS", qr: "none" } : idle;
  }
  if (["CANCELLED", "MERGED", "PAID"].includes(i.order.status)) return idle;
  const fresh = i.followedAt ? (i.now.getTime() - i.followedAt.getTime()) / 1000 <= STALE_SECONDS : false;
  if (!fresh || !i.order.hasLines) return idle;
  if (i.intent?.status === "PAID") return { kind: "PAID", qr: "none" };
  if (i.intent && ["CREATED", "PENDING"].includes(i.intent.status)) return { kind: "PAY", qr: "intent" };
  return { kind: "BILL", qr: i.hasStaticQr && (i.showQr || i.autoQr) ? "static" : "none" };
}

export interface BillOptions {
  discountPercent: number;
  redeemPoints: number;
  rewardValueMinor: number;
  stampProgramId: string | null;
  stampItemId: string | null;
}

export const NO_OPTIONS: BillOptions = { discountPercent: 0, redeemPoints: 0, rewardValueMinor: 0, stampProgramId: null, stampItemId: null };

const num = (v: unknown, min: number, max: number, whole: boolean) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return min;
  const c = Math.min(max, Math.max(min, n));
  return whole ? Math.floor(c) : c;
};
const id = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 100 ? v : null);

/** What the till sent (or what was stored) turned into safe bill options: out-of-range or missing values fall back to none. */
export function cleanOptions(raw: unknown): BillOptions {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    discountPercent: num(r.discountPercent, 0, 100, false),
    redeemPoints: num(r.redeemPoints, 0, 10_000_000, true),
    rewardValueMinor: num(r.rewardValueMinor, 0, 100_000_000, true),
    stampProgramId: id(r.stampProgramId),
    stampItemId: id(r.stampItemId),
  };
}

export interface SettingInput {
  enabled: boolean;
  welcomeTitle: string;
  welcomeText: string;
  thanksText: string;
  thanksSeconds: number;
  showNotes: boolean;
  showLogo: boolean;
  autoQr: boolean;
  qrLabel: string;
}

const clip = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);
const orNull = (v: string) => (v === "" ? null : v);

export function cleanSetting(i: SettingInput) {
  const seconds = Math.round(i.thanksSeconds);
  if (!Number.isFinite(seconds) || seconds < 3 || seconds > 120) throw new DomainError("The thank-you screen can stay 3 to 120 seconds.");
  return {
    enabled: i.enabled,
    welcomeTitle: orNull(clip(i.welcomeTitle, 60)),
    welcomeText: orNull(clip(i.welcomeText, 160)),
    thanksText: orNull(clip(i.thanksText, 160)),
    thanksSeconds: seconds,
    showNotes: i.showNotes,
    showLogo: i.showLogo,
    autoQr: i.autoQr,
    qrLabel: orNull(clip(i.qrLabel, 40)),
  };
}

export function cleanDisplayName(v: string): string {
  const n = v.replace(/\s+/g, " ").trim();
  if (n.length < 1 || n.length > 40) throw new DomainError("Give the screen a name of 1 to 40 characters.");
  return n;
}

export const MAX_QR_BYTES = 300_000;

/** The label shown over a payment QR. */
export function providerLabel(p: string): string {
  return p === "ESEWA" ? "eSewa" : p === "KHALTI" ? "Khalti" : p;
}
