import { describe, expect, it, vi } from "vitest";
import { dailyLimit, getProvider, sparrowNumber } from "./providers";

const json = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("provider selection", () => {
  it("is off by default and when settings are incomplete", () => {
    expect(getProvider({})).toBeNull();
    expect(getProvider({ MESSAGING_PROVIDER: "twilio" })).toBeNull();
    expect(getProvider({ MESSAGING_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1" })).toBeNull();
    expect(getProvider({ MESSAGING_PROVIDER: "sparrow", SPARROW_TOKEN: "t" })).toBeNull();
    expect(getProvider({ MESSAGING_PROVIDER: "webhook", MESSAGING_WEBHOOK_URL: "ftp://nope" })).toBeNull();
    expect(getProvider({ MESSAGING_PROVIDER: "carrier-pigeon" })).toBeNull();
  });
  it("picks the named provider when it is fully configured", () => {
    expect(getProvider({ MESSAGING_PROVIDER: "Twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "secret", TWILIO_FROM: "+15550001111" })?.name).toBe("Twilio");
    expect(getProvider({ MESSAGING_PROVIDER: "sparrow", SPARROW_TOKEN: "t", SPARROW_FROM: "Cafe" })?.name).toBe("Sparrow SMS");
    expect(getProvider({ MESSAGING_PROVIDER: "webhook", MESSAGING_WEBHOOK_URL: "https://x.example/send" })?.name).toBe("Webhook");
  });
  it("has a sensible daily limit", () => {
    expect(dailyLimit({})).toBe(200);
    expect(dailyLimit({ MESSAGING_DAILY_LIMIT: "50" })).toBe(50);
    for (const bad of ["0", "-5", "abc", "99999", "1.5"]) expect(dailyLimit({ MESSAGING_DAILY_LIMIT: bad })).toBe(200);
  });
});

describe("Twilio", () => {
  const env = { MESSAGING_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC123456", TWILIO_AUTH_TOKEN: "tok-secret-9", TWILIO_FROM: "+15550001111" };
  it("sends a form request with basic auth and returns the message id", async () => {
    const spy = vi.fn(json(201, { sid: "SM99" }));
    const r = await getProvider(env)!.send("+9779841234567", "Hello there", spy as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, ref: "SM99" });
    const [url, init] = spy.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123456/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("AC123456:tok-secret-9").toString("base64")}`);
    const body = init.body as URLSearchParams;
    expect(body.get("To")).toBe("+9779841234567");
    expect(body.get("Body")).toBe("Hello there");
    expect(body.get("From")).toBe("+15550001111");
  });
  it("uses a messaging service when the sender is one, and hides secrets in errors", async () => {
    const spy = vi.fn(json(400, { message: "Bad token tok-secret-9 for AC123456" }));
    const r = await getProvider({ ...env, TWILIO_FROM: "MGabc" })!.send("+1", "x", spy as unknown as typeof fetch);
    expect((spy.mock.calls[0]![1] as RequestInit).body).toSatisfy((b: URLSearchParams) => b.get("MessagingServiceSid") === "MGabc" && !b.has("From"));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("tok-secret-9");
    expect(JSON.stringify(r)).not.toContain("AC123456");
  });
});

describe("Sparrow", () => {
  const env = { MESSAGING_PROVIDER: "sparrow", SPARROW_TOKEN: "sp-token-77", SPARROW_FROM: "Cafe" };
  it("turns a Nepal number into the local one", () => {
    expect(sparrowNumber("+9779841234567")).toBe("9841234567");
    expect(sparrowNumber("+14155550123")).toBe("14155550123");
  });
  it("posts a form and succeeds only on response code 200", async () => {
    const ok = vi.fn(json(200, { response_code: 200, message_id: 42 }));
    expect(await getProvider(env)!.send("+9779841234567", "Hi", ok as unknown as typeof fetch)).toEqual({ ok: true, ref: "42" });
    const [url, init] = ok.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sparrowsms.com/v2/sms/");
    const body = init.body as URLSearchParams;
    expect([body.get("token"), body.get("from"), body.get("to"), body.get("text")]).toEqual(["sp-token-77", "Cafe", "9841234567", "Hi"]);

    const bad = await getProvider(env)!.send("+9779841234567", "Hi", json(200, { response_code: 1000, response: "Invalid token sp-token-77" }));
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain("sp-token-77");
  });
});

describe("Webhook", () => {
  const env = { MESSAGING_PROVIDER: "webhook", MESSAGING_WEBHOOK_URL: "https://hook.example/send", MESSAGING_WEBHOOK_TOKEN: "hook-secret" };
  it("posts json with a bearer token and treats any 2xx as sent", async () => {
    const spy = vi.fn(json(200, { id: "m1" }));
    expect(await getProvider(env)!.send("+977984", "Hi", spy as unknown as typeof fetch)).toEqual({ ok: true, ref: "m1" });
    const [url, init] = spy.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://hook.example/send");
    expect(JSON.parse(String(init.body))).toEqual({ to: "+977984", text: "Hi" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer hook-secret");
  });
  it("reports a failure and an unreachable server without throwing", async () => {
    expect((await getProvider(env)!.send("+1", "x", json(503, {}))).ok).toBe(false);
    const down = (async () => {
      throw new Error("connect ECONNREFUSED hook-secret");
    }) as unknown as typeof fetch;
    const r = await getProvider(env)!.send("+1", "x", down);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("hook-secret");
  });
});
