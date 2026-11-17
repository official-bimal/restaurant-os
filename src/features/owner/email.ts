/**
 * Sending the owner's summary by email. Off unless EMAIL_PROVIDER is set. Supported: "resend" (the Resend email API:
 * RESEND_API_KEY and EMAIL_FROM) and "webhook" (your own URL that receives {to, subject, text} as JSON and sends it).
 * Like the text-message providers, these follow each service's published API but have only been tested here against
 * fake replies, not live services: send one to yourself first.
 */

type Env = Record<string, string | undefined>;
export type EmailResult = { ok: true } | { ok: false; error: string };

export interface EmailProvider {
  name: string;
  send(to: string, subject: string, text: string, fetchImpl?: typeof fetch): Promise<EmailResult>;
}

const TIMEOUT_MS = 10_000;

function clean(message: unknown, secrets: (string | undefined)[]): string {
  let t = typeof message === "string" ? message : "The email service refused the message.";
  for (const s of secrets) if (s && s.length >= 4) t = t.split(s).join("***");
  return t.replace(/\s+/g, " ").slice(0, 160);
}

export function looksLikeEmail(v: string): boolean {
  return v.length <= 200 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(v);
}

function resend(env: Env): EmailProvider | null {
  const key = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!key || !from) return null;
  return {
    name: "Resend",
    async send(to, subject, text, fetchImpl = fetch) {
      try {
        const res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [to], subject, text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) return { ok: true };
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        return { ok: false, error: clean(data.message ?? `Resend answered ${res.status}.`, [key]) };
      } catch (e) {
        return { ok: false, error: clean(e instanceof Error ? e.message : "Could not reach Resend.", [key]) };
      }
    },
  };
}

function webhook(env: Env): EmailProvider | null {
  const url = env.EMAIL_WEBHOOK_URL;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const token = env.EMAIL_WEBHOOK_TOKEN;
  return {
    name: "Webhook",
    async send(to, subject, text, fetchImpl = fetch) {
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ to, subject, text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return res.ok ? { ok: true } : { ok: false, error: clean(`The webhook answered ${res.status}.`, [token]) };
      } catch (e) {
        return { ok: false, error: clean(e instanceof Error ? e.message : "Could not reach the webhook.", [token]) };
      }
    },
  };
}

let override: EmailProvider | null | undefined;
/** Tests plug in a fake so nothing leaves the machine. `undefined` goes back to the environment. */
export function setEmailProviderForTests(p: EmailProvider | null | undefined) {
  override = p;
}

export function getEmailProvider(env: Env = process.env): EmailProvider | null {
  if (override !== undefined) return override;
  switch ((env.EMAIL_PROVIDER ?? "").toLowerCase()) {
    case "resend":
      return resend(env);
    case "webhook":
      return webhook(env);
    default:
      return null;
  }
}
