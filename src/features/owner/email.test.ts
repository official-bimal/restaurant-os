import { describe, expect, it, vi } from "vitest";
import { getEmailProvider, looksLikeEmail } from "./email";

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("email provider selection", () => {
  it("is off by default and when incomplete", () => {
    expect(getEmailProvider({})).toBeNull();
    expect(getEmailProvider({ EMAIL_PROVIDER: "resend" })).toBeNull();
    expect(getEmailProvider({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k" })).toBeNull();
    expect(getEmailProvider({ EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "ftp://x" })).toBeNull();
    expect(getEmailProvider({ EMAIL_PROVIDER: "smtp" })).toBeNull();
  });
  it("picks a fully configured one", () => {
    expect(getEmailProvider({ EMAIL_PROVIDER: "Resend", RESEND_API_KEY: "re_abc12345", EMAIL_FROM: "Cafe <a@b.com>" })?.name).toBe("Resend");
    expect(getEmailProvider({ EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://x.example/mail" })?.name).toBe("Webhook");
  });
});

describe("Resend", () => {
  const env = { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_secret_key_1", EMAIL_FROM: "Cafe <a@b.com>" };
  it("posts the message with a bearer key", async () => {
    const spy = vi.fn(reply(200, { id: "1" }));
    expect(await getEmailProvider(env)!.send("owner@x.com", "Summary", "Body", spy as unknown as typeof fetch)).toEqual({ ok: true });
    const [url, init] = spy.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_secret_key_1");
    expect(JSON.parse(String(init.body))).toEqual({ from: "Cafe <a@b.com>", to: ["owner@x.com"], subject: "Summary", text: "Body" });
  });
  it("reports a refusal without leaking the key", async () => {
    const r = await getEmailProvider(env)!.send("o@x.com", "s", "b", reply(401, { message: "Invalid key re_secret_key_1" }));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("re_secret_key_1");
  });
});

describe("Webhook", () => {
  const env = { EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://hook.example/mail", EMAIL_WEBHOOK_TOKEN: "tok-secret-9" };
  it("posts json and treats 2xx as sent", async () => {
    const spy = vi.fn(reply(200, {}));
    expect((await getEmailProvider(env)!.send("o@x.com", "S", "B", spy as unknown as typeof fetch)).ok).toBe(true);
    expect(JSON.parse(String((spy.mock.calls[0]![1] as RequestInit).body))).toEqual({ to: "o@x.com", subject: "S", text: "B" });
  });
  it("does not throw when the server is down", async () => {
    const down = (async () => {
      throw new Error("ECONNREFUSED tok-secret-9");
    }) as unknown as typeof fetch;
    const r = await getEmailProvider(env)!.send("o@x.com", "S", "B", down);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("tok-secret-9");
  });
});

describe("looksLikeEmail", () => {
  it("accepts ordinary addresses and refuses obvious mistakes", () => {
    for (const ok of ["a@b.com", "owner.name+cafe@mail.co.np"]) expect(looksLikeEmail(ok)).toBe(true);
    for (const bad of ["", "abc", "a@b", "a b@c.com", "@b.com", "a@b.c", "<x>@b.com"]) expect(looksLikeEmail(bad)).toBe(false);
  });
});
