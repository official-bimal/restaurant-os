import Link from "next/link";
import { headers } from "next/headers";
import { requireTenant } from "@/server/auth";
import { baseUrlFrom } from "@/features/payments/server/base-url";
import { PROVIDERS } from "@/features/payments/gateways";
import { getPaymentSettings } from "@/features/payments/server/service";
import { savePaymentSettingAction } from "./actions";

export const dynamic = "force-dynamic";

const field = "mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base";

const HELP: Record<string, { how: string; link: string; linkText: string }> = {
  ESEWA: {
    how: "eSewa gives you a product code and a secret key when your merchant account is approved. For testing, leave the key empty in TEST mode: the app uses eSewa's published sandbox login (product code EPAYTEST).",
    link: "https://developer.esewa.com.np",
    linkText: "eSewa developer docs",
  },
  KHALTI: {
    how: "Sign up as a merchant, then copy your secret key. For testing, sign up at the Khalti sandbox and use the key it shows (test customers use 9800000000 to 9800000005, PIN 1111, code 987654).",
    link: "https://docs.khalti.com/khalti-epayment/",
    linkText: "Khalti ePayment docs",
  },
  FONEPAY: { how: "Fonepay QR is set up with your bank. Print your Fonepay QR where customers can scan it, take the payment, and type the reference the customer shows. Fonepay's dynamic-QR API is only given to approved merchants (ask your bank or Fonepay).", link: "https://www.fonepay.com/", linkText: "Fonepay" },
  CONNECTIPS: { how: "ConnectIPS is bank-to-bank and is arranged through your bank. Record the reference the customer shows.", link: "https://www.connectips.com/", linkText: "ConnectIPS" },
  IMEPAY: { how: "Customers pay in the IME Pay app and show you the confirmation. Record its reference.", link: "https://www.imepay.com.np/", linkText: "IME Pay" },
  CARD: { how: "Take the card on your bank's machine and type the approval code. Card payments through your own website need a bank gateway (Nabil, NIC Asia, HBL and others).", link: "https://github.com/manibibek/payment-gateways-in-nepal", linkText: "List of Nepal gateways" },
};

export default async function PaymentSettingsPage({ searchParams }: PageProps<"/settings/payments">) {
  const ctx = await requireTenant();
  const sp = await searchParams;
  const [settings, h] = [await getPaymentSettings(ctx), await headers()];
  const base = baseUrlFrom(h);
  const chip = (id: string) => PROVIDERS.find((p) => p.id === id)!.chip;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-sm text-stone-500 hover:underline">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold">Payments</h1>
      </div>
      {typeof sp.error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}
      {typeof sp.saved === "string" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</p>}

      <section className="card space-y-2 p-5 text-sm text-stone-600">
        <p>
          The cashier chooses how a customer paid. <strong>eSewa and Khalti</strong> can be started from the bill: the customer scans a QR code and pays on their own phone, the software asks eSewa or
          Khalti whether it was really paid, and only then can the bill be completed. <strong>Fonepay QR, ConnectIPS, IME Pay and cards</strong> are recorded with the reference the customer or the machine
          shows, because those services give their payment checks only to approved merchants.
        </p>
        <p>
          The customer&apos;s phone is sent back to <code className="rounded bg-stone-100 px-1">{base}</code> after paying, so it must be an address their phone can open. On the shop Wi-Fi that works with the shop computer&apos;s address;
          for customers away from the shop, set <code className="rounded bg-stone-100 px-1">APP_URL</code> to your public https address. Keys are stored encrypted and are never shown again after saving.
        </p>
      </section>

      <div className="space-y-4">
        {settings.map((s) => {
          const help = HELP[s.provider]!;
          return (
            <form key={s.provider} action={savePaymentSettingAction.bind(null, s.provider)} className="card space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-lg px-3 py-1 text-sm font-semibold ${chip(s.provider)}`}>{s.label}</span>
                <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{s.kind === "API" ? "Started and checked by the software" : "Recorded by hand"}</span>
                <label className="ml-auto flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name="enabled" defaultChecked={s.enabled} className="size-5" /> On
                </label>
              </div>
              <p className="text-sm text-stone-600">
                {help.how}{" "}
                <a href={help.link} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                  {help.linkText}
                </a>
              </p>
              {s.kind === "API" ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-sm">
                    Mode
                    <select name="mode" defaultValue={s.mode} className={field}>
                      <option value="TEST">Test (sandbox, no real money)</option>
                      <option value="LIVE">Live (real money)</option>
                    </select>
                  </label>
                  {s.provider === "ESEWA" && (
                    <label className="text-sm">
                      Product code
                      <input name="merchantCode" defaultValue={s.merchantCode} maxLength={60} placeholder="EPAYTEST in test mode" className={field} />
                    </label>
                  )}
                  <label className="text-sm">
                    Secret key {s.hasSecret && <span className="text-xs text-emerald-700">(saved)</span>}
                    <input name="secret" type="password" autoComplete="off" maxLength={300} placeholder={s.hasSecret ? "Leave empty to keep the saved key" : "Paste the key"} className={field} />
                  </label>
                </div>
              ) : (
                <input type="hidden" name="mode" value="TEST" />
              )}
              <button className="min-h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white">Save {s.label}</button>
            </form>
          );
        })}
      </div>
    </div>
  );
}
