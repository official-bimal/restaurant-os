"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export interface PushConfig {
  publicKey: string;
  subscribe: (sub: unknown) => Promise<{ ok: boolean; error?: string }>;
  unsubscribe: (endpoint: string) => Promise<{ ok: boolean; error?: string }>;
}

/** The browser wants the public key as bytes, not as text. */
function keyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

interface Env {
  /** Can this page receive alerts when closed? */
  supported: boolean;
  /** An iPhone or iPad. These only get alerts once the app is added to the home screen. */
  ios: boolean;
  standalone: boolean;
}

// Worked out once, in the browser. The server render uses `null` so both sides agree and nothing flashes wrongly.
let cached: Env | null = null;
function readEnv(): Env {
  if (cached) return cached;
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, but has a touch screen.
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  cached = { supported, ios, standalone };
  return cached;
}
const noop = () => () => {};
function useEnv(): Env | null {
  return useSyncExternalStore(noop, readEnv, () => null);
}

/**
 * Switches background alerts on or off for this browser. Needs the person's permission (the browser asks),
 * a secure page (https, or localhost while testing) and a browser that supports Web Push. Each person turns
 * it on for themselves; nothing is subscribed without a tap. On iPhone and iPad it explains how to install
 * the app first, because Apple only allows alerts for an installed app.
 */
export function PushToggle({ config }: { config: PushConfig }) {
  const env = useEnv();
  const [on, setOn] = useState<boolean | null>(null); // null until we know
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!env?.supported) return;
    navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setOn(!!sub))
      .catch(() => setOn(false));
  }, [env]);

  if (!env) return null;
  if (!env.supported) {
    if (env.ios && !env.standalone) {
      return (
        <div className="rounded-lg bg-amber-50 p-2 text-[11px] leading-snug text-amber-900">
          <p className="font-semibold">Alerts on iPhone and iPad</p>
          <p>
            Tap the Share button in Safari, choose <strong>Add to Home Screen</strong>, then open Restaurant OS from your home screen and turn
            alerts on there.
          </p>
        </div>
      );
    }
    return <p className="text-[11px] text-stone-500">This browser cannot receive alerts when the app is closed.</p>;
  }
  if (Notification.permission === "denied" && !on) {
    return <p className="text-[11px] text-stone-500">Alerts are blocked in this browser&rsquo;s settings.</p>;
  }

  const toggle = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const reg = (await navigator.serviceWorker.getRegistration("/sw.js")) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (on && existing) {
        await config.unsubscribe(existing.endpoint);
        await existing.unsubscribe();
        setOn(false);
        setMessage("Background alerts are off.");
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setMessage("Allow notifications in the browser to turn this on.");
          return;
        }
        const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(config.publicKey) }));
        const res = await config.subscribe(sub.toJSON());
        if (!res.ok) {
          await sub.unsubscribe();
          setMessage(res.error ?? "Could not turn alerts on.");
          return;
        }
        setOn(true);
        setMessage("Background alerts are on for this device.");
      }
    } catch {
      setMessage("Could not change the alert setting on this device.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy || on === null}
        aria-pressed={!!on}
        className={`w-full rounded-lg border px-2 py-1.5 text-xs font-medium ${on ? "border-brand-600 bg-brand-50 text-brand-700" : "border-stone-300 text-stone-600 hover:bg-stone-50"}`}
      >
        {on ? "Alerts when app is closed: on" : "Alerts when app is closed: off"}
      </button>
      {message && (
        <p role="status" className="text-[11px] text-stone-500">
          {message}
        </p>
      )}
    </div>
  );
}
