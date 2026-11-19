import { describe, expect, it } from "vitest";
import { cleanWifi, wifiQrPayload, WifiError } from "./wifi";

const base = { name: "Demo Cafe", password: "welcome123", security: "WPA", hidden: false };

describe("cleanWifi", () => {
  it("a blank name means no Wi-Fi to show", () => {
    expect(cleanWifi({ ...base, name: "   " })).toBeNull();
    expect(cleanWifi({ ...base, name: "" })).toBeNull();
  });

  it("keeps good settings, trims the name and keeps a password as typed", () => {
    expect(cleanWifi({ ...base, name: "  Demo Cafe  ", password: " pass word 1 " })).toEqual({ name: "Demo Cafe", password: " pass word 1 ", security: "WPA", hidden: false });
  });

  it("applies the real limits", () => {
    expect(() => cleanWifi({ ...base, name: "x".repeat(33) })).toThrow(WifiError);
    expect(() => cleanWifi({ ...base, name: "नेपाल".repeat(4) })).toThrow(/32/); // counted in bytes, as Wi-Fi does
    expect(() => cleanWifi({ ...base, password: "short" })).toThrow(/8 to 63/);
    expect(() => cleanWifi({ ...base, password: "x".repeat(64) })).toThrow(/8 to 63/);
    expect(cleanWifi({ ...base, password: "a".repeat(64) })!.password).toHaveLength(64); // 64 hex digits is a valid key
    expect(() => cleanWifi({ ...base, security: "WEP", password: "1234" })).toThrow(/WEP/);
    expect(() => cleanWifi({ ...base, security: "nope" })).toThrow(/secured/);
  });

  it("an open network keeps no password", () => {
    expect(cleanWifi({ ...base, security: "nopass", password: "ignored" })).toEqual({ name: "Demo Cafe", password: "", security: "nopass", hidden: false });
  });

  it("drops control characters", () => {
    expect(cleanWifi({ ...base, name: "Cafe\u0000\u0007 Wifi" })!.name).toBe("Cafe Wifi");
  });
});

describe("wifiQrPayload", () => {
  it("builds the standard format", () => {
    expect(wifiQrPayload({ name: "Demo Cafe", password: "welcome123", security: "WPA", hidden: false })).toBe("WIFI:T:WPA;S:Demo Cafe;P:welcome123;;");
  });

  it("escapes the characters that have a meaning in the format", () => {
    expect(wifiQrPayload({ name: 'A;B,C:D"E\\F', password: "p;a:s,s\\w\"d1", security: "WPA", hidden: false })).toBe('WIFI:T:WPA;S:A\\;B\\,C\\:D\\"E\\\\F;P:p\\;a\\:s\\,s\\\\w\\"d1;;');
  });

  it("wraps a name or password that looks like hex in quotes", () => {
    expect(wifiQrPayload({ name: "CAFE", password: "12345678", security: "WPA", hidden: false })).toBe('WIFI:T:WPA;S:"CAFE";P:"12345678";;');
  });

  it("leaves the password out for an open network and marks a hidden one", () => {
    expect(wifiQrPayload({ name: "Open Wifi", password: "", security: "nopass", hidden: false })).toBe("WIFI:T:nopass;S:Open Wifi;;");
    expect(wifiQrPayload({ name: "Hidden", password: "welcome123", security: "WPA", hidden: true })).toBe("WIFI:T:WPA;S:Hidden;P:welcome123;H:true;;");
  });
});
