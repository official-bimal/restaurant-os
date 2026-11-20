import { describe, expect, it } from "vitest";
import { cleanDisplayName, cleanOptions, cleanSetting, decideScreen, NO_OPTIONS, STALE_SECONDS, type DecideInput } from "./display";

const now = new Date("2026-12-01T10:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000);
const base: DecideInput = {
  enabled: true,
  now,
  orderId: "o1",
  followedAt: ago(5),
  order: { status: "OPEN", invoiceAt: null, hasLines: true },
  intent: null,
  hasStaticQr: false,
  showQr: false,
  autoQr: false,
  thanksSeconds: 12,
};
const d = (o: Partial<DecideInput>) => decideScreen({ ...base, ...o });

describe("which screen the customer sees", () => {
  it("is off when the display is switched off, whatever else is true", () => {
    expect(d({ enabled: false })).toEqual({ kind: "OFF", qr: "none" });
  });
  it("shows the welcome when nobody is being served", () => {
    expect(d({ orderId: null, order: null }).kind).toBe("IDLE");
    expect(d({ order: null }).kind).toBe("IDLE");
  });
  it("shows the bill while the till is checking in and the order has items", () => {
    expect(d({})).toEqual({ kind: "BILL", qr: "none" });
  });
  it("goes back to the welcome when the till stops checking in, or the order is empty, closed or gone", () => {
    expect(d({ followedAt: ago(STALE_SECONDS + 1) }).kind).toBe("IDLE");
    expect(d({ followedAt: ago(STALE_SECONDS - 1) }).kind).toBe("BILL");
    expect(d({ followedAt: null }).kind).toBe("IDLE");
    expect(d({ order: { status: "OPEN", invoiceAt: null, hasLines: false } }).kind).toBe("IDLE");
    for (const status of ["CANCELLED", "MERGED", "PAID"]) expect(d({ order: { status, invoiceAt: null, hasLines: true } }).kind).toBe("IDLE");
  });
  it("shows the fixed payment QR only when there is one and it was asked for", () => {
    expect(d({ hasStaticQr: true }).qr).toBe("none");
    expect(d({ hasStaticQr: true, showQr: true }).qr).toBe("static");
    expect(d({ hasStaticQr: true, autoQr: true }).qr).toBe("static");
    expect(d({ hasStaticQr: false, showQr: true, autoQr: true }).qr).toBe("none");
  });
  it("shows a started payment's own QR instead, then the payment received screen", () => {
    expect(d({ hasStaticQr: true, showQr: true, intent: { status: "CREATED" } })).toEqual({ kind: "PAY", qr: "intent" });
    expect(d({ intent: { status: "PENDING" } }).kind).toBe("PAY");
    expect(d({ intent: { status: "PAID" } })).toEqual({ kind: "PAID", qr: "none" });
    expect(d({ intent: { status: "FAILED" } }).kind).toBe("BILL");
  });
  it("thanks the customer for a few seconds after the bill is paid, even if the till has moved on", () => {
    const paid = (s: number) => d({ followedAt: null, order: { status: "PAID", invoiceAt: ago(s), hasLines: true } });
    expect(paid(2).kind).toBe("THANKS");
    expect(paid(11).kind).toBe("THANKS");
    expect(paid(12).kind).toBe("IDLE");
    expect(paid(300).kind).toBe("IDLE");
    expect(d({ thanksSeconds: 30, followedAt: null, order: { status: "PAID", invoiceAt: ago(20), hasLines: true } }).kind).toBe("THANKS");
  });
});

describe("checking what the till and the owner send", () => {
  it("turns anything into safe bill options", () => {
    expect(cleanOptions(null)).toEqual(NO_OPTIONS);
    expect(cleanOptions("x")).toEqual(NO_OPTIONS);
    expect(cleanOptions({ discountPercent: 150, redeemPoints: -4, rewardValueMinor: "12", stampProgramId: "s1", stampItemId: 5 })).toEqual({ discountPercent: 100, redeemPoints: 0, rewardValueMinor: 12, stampProgramId: "s1", stampItemId: null });
    expect(cleanOptions({ discountPercent: 12.5, redeemPoints: 40.9 })).toMatchObject({ discountPercent: 12.5, redeemPoints: 40 });
    expect(cleanOptions({ stampProgramId: "x".repeat(101) }).stampProgramId).toBeNull();
    expect(cleanOptions({ discountPercent: NaN }).discountPercent).toBe(0);
  });
  it("tidies the owner's settings", () => {
    const ok = { enabled: true, welcomeTitle: "  Welcome   to Nerro ", welcomeText: "", thanksText: "Dhanyabad!", thanksSeconds: 12.4, showNotes: true, showLogo: false, autoQr: true, qrLabel: " Scan  to pay " };
    expect(cleanSetting(ok)).toEqual({ enabled: true, welcomeTitle: "Welcome to Nerro", welcomeText: null, thanksText: "Dhanyabad!", thanksSeconds: 12, showNotes: true, showLogo: false, autoQr: true, qrLabel: "Scan to pay" });
    expect(() => cleanSetting({ ...ok, thanksSeconds: 1 })).toThrow(/3 to 120/);
    expect(() => cleanSetting({ ...ok, thanksSeconds: 500 })).toThrow(/3 to 120/);
    expect(() => cleanSetting({ ...ok, thanksSeconds: NaN })).toThrow(/3 to 120/);
    expect(cleanSetting({ ...ok, welcomeTitle: "x".repeat(200) }).welcomeTitle).toHaveLength(60);
  });
  it("tidies screen names", () => {
    expect(cleanDisplayName("  Counter   2 ")).toBe("Counter 2");
    expect(() => cleanDisplayName("  ")).toThrow(/name/);
    expect(() => cleanDisplayName("x".repeat(41))).toThrow(/name/);
  });
});
