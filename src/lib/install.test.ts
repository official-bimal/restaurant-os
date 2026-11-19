import { describe, expect, it } from "vitest";
import { installHint, isDismissed, isIos, type InstallEnv } from "./install";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const env = (o: Partial<InstallEnv>): InstallEnv => ({ userAgent: DESKTOP, platform: "Win32", maxTouchPoints: 0, standalone: false, canPrompt: false, ...o });

describe("installHint", () => {
  it("says nothing when it is already installed, even if a prompt exists", () => {
    expect(installHint(env({ standalone: true, canPrompt: true }))).toEqual({ kind: "installed" });
    expect(installHint(env({ userAgent: IPHONE, standalone: true }))).toEqual({ kind: "installed" });
  });

  it("offers the install button when the browser gave a prompt (Android, desktop)", () => {
    expect(installHint(env({ userAgent: ANDROID, platform: "Linux armv8l", canPrompt: true }))).toEqual({ kind: "prompt" });
    expect(installHint(env({ canPrompt: true }))).toEqual({ kind: "prompt" });
  });

  it("shows the steps on an iPhone or iPad, which have no install prompt", () => {
    expect(installHint(env({ userAgent: IPHONE, platform: "iPhone" }))).toEqual({ kind: "ios-steps", browser: "safari" });
    expect(installHint(env({ userAgent: IPHONE_CHROME, platform: "iPhone" }))).toEqual({ kind: "ios-steps", browser: "other" });
    expect(installHint(env({ userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 5 }))).toEqual({ kind: "ios-steps", browser: "safari" });
  });

  it("shows nothing when there is nothing to offer (a desktop or Android browser with no prompt)", () => {
    expect(installHint(env({}))).toEqual({ kind: "none" });
    expect(installHint(env({ userAgent: ANDROID, platform: "Linux armv8l" }))).toEqual({ kind: "none" });
    // A real Mac has no touch screen.
    expect(installHint(env({ userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 0 }))).toEqual({ kind: "none" });
  });
});

describe("isIos", () => {
  it("knows iPhones, iPads and iPadOS pretending to be a Mac", () => {
    expect(isIos({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: ANDROID, platform: "Linux armv8l", maxTouchPoints: 5 })).toBe(false);
  });
});

describe("isDismissed", () => {
  const now = Date.UTC(2026, 10, 19);
  it("stays away for two weeks, then may come back", () => {
    expect(isDismissed(null, now)).toBe(false);
    expect(isDismissed(now - 3 * 86_400_000, now)).toBe(true);
    expect(isDismissed(now - 15 * 86_400_000, now)).toBe(false);
    expect(isDismissed(Number.NaN, now)).toBe(false);
  });
});
