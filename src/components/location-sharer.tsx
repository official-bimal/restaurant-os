"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Lets a rider share where they are while a delivery is out. Nothing is sent until they tap the
 * button, and it stops when they tap again or leave the page. The phone's own permission prompt
 * still applies. The server keeps only the latest point and wipes it when the delivery ends.
 */
export function LocationSharer({ send }: { send: (lat: number, lng: number) => Promise<{ ok: boolean; error?: string }> }) {
  const [on, setOn] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const watch = useRef<number | null>(null);
  const last = useRef(0);

  const stop = () => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
  };
  useEffect(() => stop, []);

  const start = () => {
    if (!("geolocation" in navigator)) {
      setMessage("This phone cannot share its location.");
      return;
    }
    setMessage("Asking for your location…");
    setOn(true);
    watch.current = navigator.geolocation.watchPosition(
      async (pos) => {
        // The phone may report every second; the server only needs a point every ten.
        if (Date.now() - last.current < 10_000) return;
        last.current = Date.now();
        const res = await send(pos.coords.latitude, pos.coords.longitude);
        setMessage(res.ok ? "Sharing your location." : (res.error ?? "Could not send your location."));
        if (!res.ok) {
          stop();
          setOn(false);
        }
      },
      (err) => {
        setMessage(err.code === err.PERMISSION_DENIED ? "Location is blocked. Allow it in the browser settings to share." : "Could not get your location.");
        stop();
        setOn(false);
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
  };

  return (
    <div className="space-y-1 text-center">
      <button
        type="button"
        onClick={() => {
          if (on) {
            stop();
            setOn(false);
            setMessage("Stopped sharing.");
          } else {
            start();
          }
        }}
        aria-pressed={on}
        className={`min-h-11 w-full rounded-xl border px-4 text-sm font-medium ${on ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"}`}
      >
        {on ? "Sharing my location (tap to stop)" : "Share my location with the customer"}
      </button>
      {message && (
        <p role="status" className="text-xs text-stone-500">
          {message}
        </p>
      )}
    </div>
  );
}
