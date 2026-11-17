import { describe, expect, it } from "vitest";
import { cookiesSecure } from "./cookie-security";

describe("cookiesSecure", () => {
  it("is never on during development", () => {
    expect(cookiesSecure({ NODE_ENV: "development", APP_URL: "https://x.example" })).toBe(false);
    expect(cookiesSecure({})).toBe(false);
  });
  it("follows https in production", () => {
    expect(cookiesSecure({ NODE_ENV: "production", APP_URL: "https://shop.example.com" })).toBe(true);
    expect(cookiesSecure({ NODE_ENV: "production", APP_URL: "HTTPS://shop.example.com" })).toBe(true);
  });
  it("is off for a plain-http address, such as a local network", () => {
    expect(cookiesSecure({ NODE_ENV: "production", APP_URL: "http://192.168.1.66:3000" })).toBe(false);
    expect(cookiesSecure({ NODE_ENV: "production", APP_URL: "http://localhost:3000" })).toBe(false);
  });
  it("stays secure in production when no address is configured", () => {
    expect(cookiesSecure({ NODE_ENV: "production" })).toBe(true);
    expect(cookiesSecure({ NODE_ENV: "production", APP_URL: "  " })).toBe(true);
  });
});
