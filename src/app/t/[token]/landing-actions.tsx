"use client";

import { useState, useTransition } from "react";
import { joinRewardsAction, startOrderingAction } from "./actions";
import { GuestWifi } from "./guest-wifi";
import { useT } from "./lang";

/**
 * What a guest sees when they scan the table's QR code: a few big buttons. Order food, join the rewards, and the Wi-Fi. Each one
 * is a single tap; the rewards button opens a short form, and the Wi-Fi card is open already because copying the password is the
 * quickest thing to do. (A web page cannot join a Wi-Fi network for the guest, so that card shows the password and a QR code.)
 */
export function LandingActions({
  token,
  rewards,
  wifi,
}: {
  token: string;
  /** Rewards on: this business gives points (here or through Customer OS). */
  rewards: boolean;
  wifi: { name: string; password: string; hidden: boolean; qr: string } | null;
}) {
  const t = useT();
  const [joining, setJoining] = useState(false);
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const join = () => {
    setError(null);
    start(async () => {
      // On success the action sends the guest on to the menu, so only a failure comes back here.
      const r = await joinRewardsAction(token, { phone, marketingConsent: consent });
      if (r?.error) setError(r.error);
    });
  };

  const tile = "flex min-h-20 w-full items-center gap-4 rounded-2xl bg-white p-4 text-left border border-stone-200 shadow-sm";

  return (
    <section aria-label={t("hubTitle")} className="mt-6 space-y-3">
      <h2 className="font-semibold">{t("hubTitle")}</h2>

      <form action={startOrderingAction.bind(null, token)}>
        <button className={`${tile} bg-brand-600 text-white ring-0 hover:bg-brand-700`}>
          <span aria-hidden="true" className="text-3xl">
            🍽
          </span>
          <span>
            <span className="block text-lg font-semibold">{t("tileOrder")}</span>
            <span className="block text-sm opacity-90">{t("tileOrderSub")}</span>
          </span>
        </button>
      </form>

      {rewards && (
        <div className="rounded-2xl bg-white border border-stone-200 shadow-sm">
          <button type="button" onClick={() => setJoining((v) => !v)} aria-expanded={joining} className="flex min-h-20 w-full items-center gap-4 p-4 text-left">
            <span aria-hidden="true" className="text-3xl">
              ⭐
            </span>
            <span>
              <span className="block text-lg font-semibold">{t("tileRewards")}</span>
              <span className="block text-sm text-stone-500">{t("tileRewardsSub")}</span>
            </span>
          </button>
          {joining && (
            <form
              className="space-y-3 border-t border-stone-100 p-4 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                join();
              }}
            >
              <label className="block font-medium">
                {t("yourPhone")}
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="98XXXXXXXX"
                  maxLength={30}
                  required
                  className="mt-1 block min-h-11 w-full rounded-xl px-3 py-2 text-base"
                />
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4" />
                <span>{t("offersConsent")}</span>
              </label>
              <p className="text-xs text-stone-500">{t("numberUse")}</p>
              {error && (
                <p role="alert" className="rounded-lg bg-red-50 p-2 text-red-800">
                  {error}
                </p>
              )}
              <button disabled={pending || phone.trim().length === 0} className="min-h-12 w-full rounded-full bg-brand-600 px-4 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {pending ? t("saving") : t("joinNow")}
              </button>
            </form>
          )}
        </div>
      )}

      {wifi && <GuestWifi name={wifi.name} password={wifi.password} hidden={wifi.hidden} qr={wifi.qr} />}
    </section>
  );
}
