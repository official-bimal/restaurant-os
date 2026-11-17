import { describe, expect, it, vi } from "vitest";
import { MAX_STREAMS_PER_USER, listenerCount, publishLive, publishLiveSoon, registerStream, subscribeLive } from "./live";

describe("live channel", () => {
  it("delivers an event to every listener and stops after unsubscribe", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeLive(a);
    const offB = subscribeLive(b);
    publishLive({ businessId: "biz1", topic: "order.create" });
    expect(a).toHaveBeenCalledWith({ businessId: "biz1", topic: "order.create" });
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    publishLive({ businessId: "biz1", topic: "again" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
    expect(listenerCount()).toBe(0);
  });

  it("keeps going when one listener throws", () => {
    const bad = subscribeLive(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    const off = subscribeLive(good);
    expect(() => publishLive({ businessId: "b", topic: "t" })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    bad();
    off();
  });

  it("publishes a moment later when asked to", async () => {
    const l = vi.fn();
    const off = subscribeLive(l);
    publishLiveSoon({ businessId: "b", topic: "later" }, 10);
    expect(l).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 40));
    expect(l).toHaveBeenCalledTimes(1);
    off();
  });

  it("closes a person's oldest stream when they open too many", () => {
    const closers = Array.from({ length: MAX_STREAMS_PER_USER + 2 }, () => vi.fn());
    const releases = closers.map((c) => registerStream("user-x", c));
    // the first two were closed to make room; the rest are still open
    expect(closers.slice(0, 2).every((c) => c.mock.calls.length === 1)).toBe(true);
    expect(closers.slice(2).every((c) => c.mock.calls.length === 0)).toBe(true);
    releases.forEach((r) => r());
    // another person is not affected
    const other = vi.fn();
    const rel = registerStream("user-y", other);
    expect(other).not.toHaveBeenCalled();
    rel();
  });
});
