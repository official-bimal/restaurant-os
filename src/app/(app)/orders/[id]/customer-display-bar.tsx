"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Screen {
  id: string;
  name: string;
  token: string | null;
}
interface Options {
  discountPercent: number;
  redeemPoints: number;
  rewardValueMinor: number;
  stampProgramId: string | null;
  stampItemId: string | null;
}

const BEAT_MS = 15_000;

/**
 * The till's side of the customer display. It points the chosen screen at this order (and keeps it fresh), and offers the three ways to show
 * it: a second monitor, this same screen (a full-screen view with one button back), or another device that simply opens the screen's link.
 * Which screen this till uses is remembered on this device only, so two tills can drive two screens.
 */
export function CustomerDisplayBar({ screens, orderId, branchId, options, hasQr }: { screens: Screen[]; orderId: string; branchId: string; options: Options; hasQr: boolean }) {
  const storeKey = `ros-display:${branchId}`;
  const [pick, setPick] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const active = useRef<string>("");

  // Remember the screen this device uses. One screen: use it. Several: the last one chosen here ("off" means this till shows nothing).
  useEffect(() => {
    let saved = "";
    try {
      saved = window.localStorage.getItem(storeKey) ?? "";
    } catch {
      saved = "";
    }
    const valid = saved === "off" || screens.some((s) => s.id === saved) ? saved : screens.length === 1 ? screens[0]!.id : "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPick(valid);
    setReady(true);
  }, [screens, storeKey]);

  const choose = (v: string) => {
    setPick(v);
    try {
      window.localStorage.setItem(storeKey, v);
    } catch {
      /* private mode: the choice just is not remembered */
    }
  };

  const send = useCallback(
    async (displayId: string, order: string | null, keepalive = false) => {
      try {
        const res = await fetch("/api/display-follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayId, orderId: order, options, showQr }),
          keepalive,
        });
        setProblem(res.ok ? null : "The customer screen could not be updated.");
      } catch {
        setProblem("The customer screen could not be updated.");
      }
    },
    [options, showQr],
  );

  const optionsKey = useMemo(() => JSON.stringify(options), [options]);

  // Point the screen at this order now, again whenever the bill options change, and every few seconds while this page is open.
  useEffect(() => {
    if (!ready || !pick || pick === "off") return;
    active.current = pick;
    // The first update is sent at once; it only sets state after the network call finishes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void send(pick, orderId);
    const t = setInterval(() => void send(pick, orderId), BEAT_MS);
    return () => clearInterval(t);
  }, [ready, pick, orderId, optionsKey, showQr, send]);

  // Leaving the page (or switching the screen off) sends the screen back to the welcome.
  useEffect(() => {
    if (!ready || !pick || pick === "off") return;
    const id = pick;
    const leave = () => void send(id, null, true);
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
    // `send` changes with the options; only the screen choice should trigger leaving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pick]);

  useEffect(() => {
    if (!overlay) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOverlay(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [overlay]);

  const screen = screens.find((s) => s.id === pick) ?? null;
  const url = screen?.token ? `/display/${screen.token}` : null;

  const secondMonitor = async () => {
    if (!url) return;
    let features = "popup=yes,width=1024,height=768";
    let msg = "A window opened: drag it to the customer's screen and double-click it for full screen.";
    try {
      const w = window as unknown as { getScreenDetails?: () => Promise<{ screens: { availLeft: number; availTop: number; availWidth: number; availHeight: number; isPrimary: boolean }[] }> };
      const other = w.getScreenDetails ? (await w.getScreenDetails()).screens.find((s) => !s.isPrimary) : undefined;
      if (other) {
        features = `popup=yes,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
        msg = "Opened on the second monitor. Double-click it for full screen.";
      }
    } catch {
      /* the browser did not allow it: the plain window is used */
    }
    const win = window.open(url, `customer-display-${screen!.id}`, features);
    setNote(win ? msg : "The browser blocked the window. Allow pop-ups for this site and try again.");
  };

  if (!ready) return null;
  const btn = "min-h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium hover:bg-stone-50";
  return (
    <section aria-label="Customer display" className="card flex flex-wrap items-center gap-2 p-3">
      <span className="mr-1 text-sm font-semibold">Customer display</span>
      {screens.length > 1 || pick === "" || pick === "off" ? (
        <select value={pick} onChange={(e) => choose(e.target.value)} aria-label="Which customer screen this till uses" className="h-9 rounded-lg px-2 text-sm">
          <option value="">Choose a screen…</option>
          <option value="off">Not using one on this till</option>
          {screens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-sm text-stone-600">{screen?.name}</span>
      )}
      {screen && url && (
        <>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-900">Showing this order</span>
          <button type="button" className={btn} onClick={() => setOverlay(true)}>
            Show to customer
          </button>
          <button type="button" className={btn} onClick={secondMonitor}>
            Second monitor
          </button>
          {hasQr && (
            <button type="button" aria-pressed={showQr} className={`${btn} ${showQr ? "!border-brand-600 !bg-brand-50 !text-brand-700" : ""}`} onClick={() => setShowQr((v) => !v)}>
              {showQr ? "Hide payment QR" : "Show payment QR"}
            </button>
          )}
          <button type="button" className={`${btn} ml-auto`} onClick={() => choose("off")}>
            Stop showing
          </button>
        </>
      )}
      {problem && (
        <span role="alert" className="text-sm text-red-700">
          {problem}
        </span>
      )}
      {note && <span className="w-full text-xs text-stone-500">{note}</span>}

      {overlay && url && (
        <div className="fixed inset-0 z-[70] bg-stone-100" role="dialog" aria-modal="true" aria-label="What the customer sees">
          <iframe src={`${url}?embedded=1`} title="Customer screen" className="size-full border-0" />
          <button type="button" onClick={() => setOverlay(false)} className="absolute right-4 top-4 rounded-xl bg-stone-900/80 px-5 py-3 text-base font-semibold text-white shadow-lg hover:bg-stone-900">
            Back to till (Esc)
          </button>
        </div>
      )}
    </section>
  );
}
