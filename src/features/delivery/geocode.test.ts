import { afterEach, describe, expect, it, vi } from "vitest";
import { geocodeAddress, phoneKey } from "./geocode";

const reply = (body: unknown, ok = true) => (async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 })) as unknown as typeof fetch;

describe("geocodeAddress", () => {
  afterEach(() => {
    delete process.env.GEOCODER_URL;
    delete process.env.GEOCODER_COUNTRY;
  });

  it("is off unless a server is configured, and then sends nothing anywhere", async () => {
    const spy = vi.fn(reply([{ lat: "27.7", lon: "85.3" }]));
    expect(await geocodeAddress("House 4, Lakeside, Pokhara", spy as unknown as typeof fetch)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("asks the configured server with only the address text", async () => {
    process.env.GEOCODER_URL = "https://geo.example.test/";
    process.env.GEOCODER_COUNTRY = "np";
    const spy = vi.fn(reply([{ lat: "28.2096", lon: "83.9856" }]));
    const p = await geocodeAddress("House 4, Lakeside, Pokhara", spy as unknown as typeof fetch);
    expect(p).toEqual({ lat: 28.2096, lng: 83.9856 });
    const url = new URL(String(spy.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://geo.example.test/search");
    expect(url.searchParams.get("q")).toBe("House 4, Lakeside, Pokhara");
    expect(url.searchParams.get("countrycodes")).toBe("np");
    expect([...url.searchParams.keys()].sort()).toEqual(["addressdetails", "countrycodes", "format", "limit", "q"]);
  });

  it("gives up quietly on a down server, a bad answer, nothing found, or a silly address", async () => {
    process.env.GEOCODER_URL = "https://geo.example.test";
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await geocodeAddress("House 4, Lakeside", down)).toBeNull();
    expect(await geocodeAddress("House 4, Lakeside", reply([], true))).toBeNull();
    expect(await geocodeAddress("House 4, Lakeside", reply("oops", true))).toBeNull();
    expect(await geocodeAddress("House 4, Lakeside", reply([{ lat: "999", lon: "10" }]))).toBeNull();
    expect(await geocodeAddress("House 4, Lakeside", reply([], false))).toBeNull();
    expect(await geocodeAddress("abc", reply([{ lat: "1", lon: "1" }]))).toBeNull();
    expect(await geocodeAddress("x".repeat(400), reply([{ lat: "1", lon: "1" }]))).toBeNull();
  });
});

describe("phoneKey", () => {
  it("treats different ways of writing one number as the same", () => {
    expect(phoneKey("9841234567")).toBe("9841234567");
    expect(phoneKey("+977 984-1234567")).toBe("9841234567");
    expect(phoneKey("00977 9841234567")).toBe("9841234567");
  });
  it("refuses numbers that are too short or too long", () => {
    expect(phoneKey("12345")).toBeNull();
    expect(phoneKey("1".repeat(16))).toBeNull();
    expect(phoneKey("")).toBeNull();
  });
});
