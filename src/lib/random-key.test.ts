import { describe, expect, it } from "vitest";
import { randomKey } from "./random-key";

describe("randomKey", () => {
  it("is 32 hex characters, which the server accepts as an idempotency key", () => {
    const k = randomKey();
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(/^[A-Za-z0-9_-]{8,64}$/.test(k)).toBe(true);
  });
  it("is different every time", () => {
    expect(new Set(Array.from({ length: 50 }, randomKey)).size).toBe(50);
  });
  it("does not need crypto.randomUUID (missing on plain-http pages)", () => {
    const original = crypto.randomUUID;
    // @ts-expect-error simulate an insecure page
    crypto.randomUUID = undefined;
    try {
      expect(randomKey()).toHaveLength(32);
    } finally {
      crypto.randomUUID = original;
    }
  });
});
