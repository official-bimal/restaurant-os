"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clockInAction, clockOutAction } from "@/app/(app)/time/actions";

/** Where the phone is right now, or an error in plain words. Only called at the moment of tapping Clock in or out. */
function readLocation(timeoutMs: number): Promise<{ lat: number; lng: number; accuracy: number } | { error: string }> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) return resolve({ error: "This phone cannot share its location." });
    if (!window.isSecureContext) {
      return resolve({ error: "Location only works on a secure (https) connection, and this app is opened over plain http. Ask the owner to set up https." });
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => resolve({ error: e.code === e.PERMISSION_DENIED ? "Location is blocked. Allow it for this site in the browser settings, then try again." : "Could not get your location. Check that GPS is on and try again." }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10_000 },
    );
  });
}

/**
 * Clock in / out for the signed-in person, shown in the menu on every page. When the business requires it, the phone's
 * location is read at the moment of tapping and sent with the request; nothing is tracked in between.
 */
export function ClockWidget({
  since,
  workedTodayMinutes,
  timeZone,
  askLocation,
}: {
  since: string | null;
  workedTodayMinutes: number;
  timeZone: string;
  askLocation: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sinceDate = since ? new Date(since) : null;

  const run = (kind: "in" | "out") => {
    setError(null);
    startTransition(async () => {
      let loc: { lat: number; lng: number; accuracy: number } | null = null;
      if (askLocation) {
        const r = await readLocation(kind === "in" ? 15_000 : 6_000);
        if ("error" in r) {
          // Clocking in needs the location; clocking out goes ahead without it (nobody gets stuck on the clock).
          if (kind === "in") return setError(r.error);
        } else {
          loc = r;
        }
      }
      const res = kind === "in" ? await clockInAction(loc) : await clockOutAction(loc);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  const hours = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
      {sinceDate ? (
        <>
          <p className="font-medium text-emerald-800">Clocked in since {sinceDate.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" })}</p>
          <button
            onClick={() => run("out")}
            disabled={pending}
            className="mt-2 min-h-10 w-full rounded-lg border border-stone-300 bg-white text-sm font-medium hover:bg-stone-100 disabled:opacity-60"
          >
            {pending ? "Checking…" : "Clock out"}
          </button>
        </>
      ) : (
        <>
          <p className="text-stone-600">Not clocked in{workedTodayMinutes > 0 ? ` · ${hours(workedTodayMinutes)} today` : ""}</p>
          <button
            onClick={() => run("in")}
            disabled={pending}
            className="mt-2 min-h-10 w-full rounded-lg bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? (askLocation ? "Checking your location…" : "Clocking in…") : "Clock in"}
          </button>
          {askLocation && <p className="mt-1 text-xs text-stone-500">You must be at the cafe to clock in.</p>}
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-800">
          {error}
        </p>
      )}
      <Link href="/time" className="mt-2 block text-xs text-stone-500 underline">
        My hours
      </Link>
    </div>
  );
}
