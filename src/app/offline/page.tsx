import type { Metadata } from "next";
import { RetryButton } from "./retry-button";

export const metadata: Metadata = { title: "You are offline", robots: { index: false, follow: false } };

/**
 * Shown by the service worker when a page cannot be reached because the phone has no connection. It is saved on the phone when the
 * app is first opened, and holds nothing private.
 */
export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-stone-50 p-6 text-center">
      <div className="max-w-sm space-y-3">
        <p aria-hidden="true" className="text-5xl">
          📡
        </p>
        <h1 className="text-xl font-semibold">You are offline</h1>
        <p className="text-stone-600">This page needs an internet connection. Check your Wi-Fi or mobile data, then try again.</p>
        <RetryButton />
        <p className="text-xs text-stone-500">Staff: Quick order still works with no connection if you opened it earlier on this phone.</p>
      </div>
    </main>
  );
}
