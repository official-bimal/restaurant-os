"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { installHint, isDismissed, type InstallEnv } from "@/lib/install";
import { useT } from "@/app/t/[token]/lang";

/**
 * "Install the app": a small card that appears only when installing is possible and the visitor has not already done it or waved
 * it away. On Android and desktop Chrome it is one button (the browser's own install dialog opens). On an iPhone or iPad Safari has no
 * install button for web pages, so the card shows the two taps to make by hand (Share, then Add to Home Screen).
 * `who` only changes the wording: staff get the app for alerts and quick billing, customers get the restaurant on their home screen.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const KEY = "ros-install-dismissed";
const noop = () => () => {};

/** Browser facts, read once on the phone. The server draws nothing, so the page and the phone never disagree. */
function readBrowser(): Omit<InstallEnv, "canPrompt"> | null {
  if (typeof window === "undefined") return null;
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true,
  };
}
function readDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY));
    return isDismissed(Number.isFinite(at) && at > 0 ? at : null, Date.now());
  } catch {
    return false; // storage blocked: the card simply shows
  }
}
let cachedBrowser: ReturnType<typeof readBrowser> | undefined;
const getBrowser = () => (cachedBrowser === undefined ? (cachedBrowser = readBrowser()) : cachedBrowser);

export function InstallApp({ who, className = "" }: { who: "staff" | "customer"; className?: string }) {
  const browser = useSyncExternalStore(noop, getBrowser, () => null);
  // Customers read the card in the language they chose on the page; staff always read English.
  const t = useT();
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissedNow, setDismissedNow] = useState(false);
  // Waved away earlier on this phone? Read from storage, once. The server draws nothing here, so nothing flashes.
  const dismissedBefore = useSyncExternalStore(noop, readDismissed, () => true);
  const dismissed = dismissedNow || dismissedBefore;
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the browser's own mini-bar away: this card is the invitation
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!browser || dismissed || installed) return null;
  const hint = installHint({ ...browser, canPrompt: promptEvent !== null });
  if (hint.kind === "installed" || hint.kind === "none") return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* storage blocked: it comes back next time, which is harmless */
    }
    setDismissedNow(true);
  };

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    if (choice.outcome === "dismissed") dismiss();
  };

  const customer = who === "customer";
  const title = customer ? t("installTitle") : "Install the staff app";
  const why = customer ? t("installWhy") : "Opens full screen from your home screen, and on iPhone it is needed for alerts.";

  return (
    <section aria-label={title} className={`rounded-xl border border-stone-200 bg-white p-3 text-sm shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-stone-600">{why}</p>
        </div>
        <button type="button" onClick={dismiss} aria-label={customer ? t("installNotNow") : "Not now"} className="h-8 w-8 shrink-0 rounded-full text-lg text-stone-500 hover:bg-stone-100">
          ×
        </button>
      </div>
      {hint.kind === "prompt" ? (
        <button type="button" onClick={install} className="mt-2 min-h-11 w-full rounded-full bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700">
          {customer ? t("installButton") : "Install app"}
        </button>
      ) : (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-stone-700">
          <li>{customer ? t(hint.browser === "other" ? "installIosOther" : "installIos1") : hint.browser === "other" ? "Tap the Share button in this browser's menu, or open this page in Safari." : "Tap the Share button (a square with an arrow)."}</li>
          <li>{customer ? t("installIos2") : "Choose Add to Home Screen, then Add."}</li>
        </ol>
      )}
    </section>
  );
}
