/**
 * Sending a text message through a provider you choose. Nothing here runs unless MESSAGING_PROVIDER is set, and the app
 * only ever calls it when an authorized person confirms a send (see send.ts). Credentials come from the environment and
 * are never logged or shown; error messages are cut down so a provider's reply cannot leak them.
 *
 * Supported: "twilio", "sparrow" (Sparrow SMS, Nepal) and "webhook" (your own URL that takes {to, text} and sends it).
 * The request shapes follow each provider's published API, but this code has NOT been run against the live services:
 * try it with one message to yourself first.
 */

export type SendResult = { ok: true; ref?: string } | { ok: false; error: string };

export interface Provider {
  name: string;
  send(to: string, text: string, fetchImpl?: typeof fetch): Promise<SendResult>;
}

type Env = Record<string, string | undefined>;

const TIMEOUT_MS = 10_000;

/** Keep a provider's error short and free of anything that looks like a secret. */
function clean(message: unknown, secrets: (string | undefined)[]): string {
  let t = typeof message === "string" ? message : "The provider refused the message.";
  for (const s of secrets) if (s && s.length >= 4) t = t.split(s).join("***");
  return t.replace(/\s+/g, " ").slice(0, 160);
}

/** "+9779841234567" to the 10-digit local number Sparrow expects; other numbers go as digits only. */
export function sparrowNumber(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  return digits.startsWith("977") && digits.length === 13 ? digits.slice(3) : digits;
}

function twilio(env: Env): Provider | null {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM;
  if (!sid || !token || !from) return null;
  return {
    name: "Twilio",
    async send(to, text, fetchImpl = fetch) {
      try {
        const body = new URLSearchParams({ To: to, Body: text });
        if (from.startsWith("MG")) body.set("MessagingServiceSid", from);
        else body.set("From", from);
        const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
          method: "POST",
          headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
        if (res.ok && data.sid) return { ok: true, ref: data.sid };
        return { ok: false, error: clean(data.message ?? `Twilio answered ${res.status}.`, [sid, token]) };
      } catch (e) {
        return { ok: false, error: clean(e instanceof Error ? e.message : "Could not reach Twilio.", [sid, token]) };
      }
    },
  };
}

function sparrow(env: Env): Provider | null {
  const token = env.SPARROW_TOKEN;
  const from = env.SPARROW_FROM;
  if (!token || !from) return null;
  return {
    name: "Sparrow SMS",
    async send(to, text, fetchImpl = fetch) {
      try {
        const res = await fetchImpl("https://api.sparrowsms.com/v2/sms/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token, from, to: sparrowNumber(to), text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const data = (await res.json().catch(() => ({}))) as { response_code?: number; response?: string; message_id?: string | number };
        if (res.ok && data.response_code === 200) return { ok: true, ref: data.message_id !== undefined ? String(data.message_id) : undefined };
        return { ok: false, error: clean(data.response ?? `Sparrow answered ${res.status}.`, [token]) };
      } catch (e) {
        return { ok: false, error: clean(e instanceof Error ? e.message : "Could not reach Sparrow.", [token]) };
      }
    },
  };
}

function webhook(env: Env): Provider | null {
  const url = env.MESSAGING_WEBHOOK_URL;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const token = env.MESSAGING_WEBHOOK_TOKEN;
  return {
    name: "Webhook",
    async send(to, text, fetchImpl = fetch) {
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ to, text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return { ok: false, error: clean(`The webhook answered ${res.status}.`, [token]) };
        const data = (await res.json().catch(() => ({}))) as { id?: string | number };
        return { ok: true, ref: data.id !== undefined ? String(data.id) : undefined };
      } catch (e) {
        return { ok: false, error: clean(e instanceof Error ? e.message : "Could not reach the webhook.", [token]) };
      }
    },
  };
}

let override: Provider | null | undefined;
/** Tests plug in a fake provider so nothing leaves the machine. `undefined` goes back to the environment. */
export function setProviderForTests(p: Provider | null | undefined) {
  override = p;
}

/** The configured provider, or null when messaging is not set up (the default). */
export function getProvider(env: Env = process.env): Provider | null {
  if (override !== undefined) return override;
  switch ((env.MESSAGING_PROVIDER ?? "").toLowerCase()) {
    case "twilio":
      return twilio(env);
    case "sparrow":
      return sparrow(env);
    case "webhook":
      return webhook(env);
    default:
      return null;
  }
}

/** The most messages one business may send in a day through the provider (a guard against a mistake or a runaway). */
export function dailyLimit(env: Env = process.env): number {
  const n = Number(env.MESSAGING_DAILY_LIMIT ?? 200);
  return Number.isInteger(n) && n > 0 && n <= 10_000 ? n : 200;
}
