"use client";

import { useState } from "react";

interface ScreenDetail {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary: boolean;
}

/**
 * Open a customer screen the way this shop works. "Second monitor" puts a window on the other screen when the browser allows it (it asks
 * once); if there is only one monitor it opens a window to drag over. "This screen" opens the same page in a new tab for a laptop that is
 * turned around to the customer. Another device (a tablet) just opens the link.
 */
export function OpenButtons({ url, label }: { url: string; label: string }) {
  const [note, setNote] = useState<string | null>(null);

  const secondMonitor = async () => {
    setNote(null);
    let msg = "On the customer's monitor, double-click the screen (or press the corner button) for full screen.";
    let features = "popup=yes,width=1024,height=768";
    try {
      const w = window as unknown as { getScreenDetails?: () => Promise<{ screens: ScreenDetail[] }> };
      if (w.getScreenDetails) {
        const d = await w.getScreenDetails();
        const other = d.screens.find((s) => !s.isPrimary);
        if (other) features = `popup=yes,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
        else msg = "Only one monitor found. A window opened: drag it to the customer's screen, then double-click it for full screen.";
      } else {
        msg = "A window opened: drag it to the customer's screen, then double-click it for full screen.";
      }
    } catch {
      msg = "The browser did not allow finding the second monitor. A window opened: drag it over, then double-click it for full screen.";
    }
    const win = window.open(url, `customer-display-${label}`, features);
    setNote(win ? msg : "The browser blocked the window. Allow pop-ups for this site and try again.");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={secondMonitor} className="btn-primary">
          Open on second monitor
        </button>
        <a href={url} target="_blank" rel="noreferrer" className="btn-secondary">
          Open in a new tab
        </a>
      </div>
      {note && (
        <p role="status" className="text-sm text-stone-600">
          {note}
        </p>
      )}
    </div>
  );
}
