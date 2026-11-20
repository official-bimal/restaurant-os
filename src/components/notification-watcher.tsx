"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { PushToggle, type PushConfig } from "./push-toggle";
import { InstallApp } from "./install-app";
import { useRouter } from "next/navigation";

interface Alert {
  id: string;
  title: string;
}

const SOUND_KEY = "ros-notify-sound";
const DESKTOP_KEY = "ros-notify-desktop";
const CHANGED = "ros-notify-changed";

// Settings live in this browser's localStorage, read through useSyncExternalStore so the server
// render and the first client render agree (both "off") and no state is set inside an effect.
function subscribe(cb: () => void) {
  window.addEventListener(CHANGED, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGED, cb);
    window.removeEventListener("storage", cb);
  };
}
const announce = () => window.dispatchEvent(new Event(CHANGED));

function useFlag(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key) === "1",
    () => false,
  );
}
function usePermission(): NotificationPermission | "unsupported" {
  return useSyncExternalStore(
    subscribe,
    () => ("Notification" in window ? Notification.permission : "unsupported"),
    () => "default",
  );
}

/** A short two-tone chime made with the browser's own audio, so no sound file is needed. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.32);
    });
    setTimeout(() => void ctx.close(), 900);
  } catch {
    // No audio available: the badge still shows.
  }
}

/**
 * Keeps the page fresh and, when something new and urgent turns up, plays a chime and (if the
 * person allowed it) shows a desktop notification. Works while the app is open in a browser tab;
 * it is not a background push service, so nothing arrives once the tab is closed.
 * Both are off until the person turns them on, and the choice is kept in this browser only.
 */
export function NotificationWatcher({ alerts, push }: { alerts: Alert[]; push: PushConfig | null }) {
  const router = useRouter();
  const sound = useFlag(SOUND_KEY);
  const desktop = useFlag(DESKTOP_KEY);
  const permission = usePermission();
  const seen = useRef<Set<string> | null>(null);

  // Refresh the layout every so often so the badge and alerts stay current on every page.
  useEffect(() => {
    // With no connection a refresh would fail and the browser would fall back to reloading the whole page, which throws away
    // whatever someone is in the middle of (a bill being made offline). So refresh only when the server can really be reached.
    const tick = async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        await fetch("/manifest.webmanifest", { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(3000) });
      } catch {
        return;
      }
      router.refresh();
    };
    const id = setInterval(() => void tick(), 15000);
    // A guest asking for the bill or the waiter is told to the page at once, not at the next 15-second refresh.
    let source: EventSource | null = null;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    if (typeof EventSource !== "undefined") {
      source = new EventSource("/api/live");
      source.addEventListener("change", (e) => {
        try {
          if ((JSON.parse((e as MessageEvent<string>).data) as { topic?: string }).topic !== "guest") return;
        } catch {
          return;
        }
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          if (document.visibilityState === "visible") router.refresh();
        }, 300);
      });
    }
    return () => {
      clearInterval(id);
      clearTimeout(debounce);
      source?.close();
    };
  }, [router]);

  // Alert only for ones not seen before in this tab. The first load just records what is already there.
  useEffect(() => {
    const ids = new Set(alerts.map((a) => a.id));
    if (seen.current === null) {
      seen.current = ids;
      return;
    }
    const fresh = alerts.filter((a) => !seen.current!.has(a.id));
    seen.current = ids;
    if (fresh.length === 0) return;
    if (sound) chime();
    if (desktop && permission === "granted") {
      const body = fresh.length === 1 ? fresh[0]!.title : `${fresh.length} new alerts`;
      try {
        new Notification("Restaurant OS", { body, tag: "ros-alert" });
      } catch {
        // Some browsers refuse to create one from here; the chime and badge still work.
      }
    }
  }, [alerts, sound, desktop, permission]);

  const toggleSound = () => {
    const next = !sound;
    localStorage.setItem(SOUND_KEY, next ? "1" : "0");
    announce();
    if (next) chime(); // a tap is the gesture browsers need before they allow sound, and it previews it
  };

  const toggleDesktop = async () => {
    if (desktop) {
      localStorage.setItem(DESKTOP_KEY, "0");
      announce();
      return;
    }
    if (!("Notification" in window)) return;
    const result = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (result === "granted") localStorage.setItem(DESKTOP_KEY, "1");
    announce();
  };

  const chip = (on: boolean) =>
    `flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium ${on ? "border-brand-600 bg-brand-50 text-brand-700" : "border-stone-300 text-stone-600 hover:bg-stone-50"}`;

  return (
    <div className="space-y-1 px-1" aria-label="Alert settings">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Alerts on this device</p>
      <div className="flex gap-2">
        <button type="button" onClick={toggleSound} aria-pressed={sound} className={chip(sound)}>
          Sound {sound ? "on" : "off"}
        </button>
        {permission !== "unsupported" && (
          <button type="button" onClick={toggleDesktop} aria-pressed={desktop} disabled={permission === "denied"} className={chip(desktop)}>
            Pop-ups {desktop ? "on" : "off"}
          </button>
        )}
      </div>
      {permission === "denied" && <p className="text-[11px] text-stone-500">Pop-ups are blocked in this browser&rsquo;s settings.</p>}
      {push && <PushToggle config={push} />}
      <InstallApp who="staff" className="mt-2" />
    </div>
  );
}
