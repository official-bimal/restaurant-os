"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatNpr } from "@/features/billing/calc";
import type { ScreenState } from "@/features/display/server/service";

/**
 * The customer's screen. It asks the server what to show every second or two and draws it: a welcome, the bill as it is built, the payment
 * QR, and a thank-you. It has no controls the customer could press by mistake (double-click or the corner button makes it full screen).
 */

const POLL_MS = 1500;

function Check() {
  return (
    <svg viewBox="0 0 24 24" className="size-24 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="m7.5 12.5 3 3 6-6.5" />
    </svg>
  );
}

function Brand({ s }: { s: ScreenState }) {
  return s.logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={s.logo} alt={s.business} className="h-16 w-auto max-w-[16rem] rounded-lg bg-white object-contain p-1" />
  ) : (
    <span className="text-2xl font-semibold tracking-tight">{s.business}</span>
  );
}

function Bill({ s, compact }: { s: ScreenState; compact?: boolean }) {
  const t = s.totals;
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="mb-4 text-xl font-semibold text-stone-500">Your order</h2>
      <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-label="Items">
        {s.lines.map((l, i) => (
          <li key={i} className="flex items-start gap-4">
            <span className={`w-10 shrink-0 text-right font-semibold tabular-nums text-stone-500 ${compact ? "text-xl" : "text-2xl"}`}>{l.qty}×</span>
            <span className="min-w-0 flex-1">
              <span className={`block font-medium leading-tight ${compact ? "text-xl" : "text-2xl"}`}>{l.name}</span>
              {l.extras.length > 0 && <span className="block text-base text-stone-500">+ {l.extras.join(", ")}</span>}
              {l.note && <span className="block text-base italic text-stone-500">{l.note}</span>}
            </span>
            <span className={`shrink-0 font-semibold tabular-nums ${compact ? "text-xl" : "text-2xl"}`}>{l.free ? "Free" : formatNpr(l.total)}</span>
          </li>
        ))}
      </ul>
      {t && (
        <dl className="mt-5 space-y-1.5 border-t border-stone-200 pt-4 text-lg text-stone-600">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{formatNpr(t.subtotal)}</dd>
          </div>
          {t.discount > 0 && (
            <div className="flex justify-between text-emerald-700">
              <dt>Discount{t.dealName ? ` (${t.dealName})` : ""}</dt>
              <dd className="tabular-nums">-{formatNpr(t.discount)}</dd>
            </div>
          )}
          {t.loyaltyDiscount > 0 && (
            <div className="flex justify-between text-emerald-700">
              <dt>Reward</dt>
              <dd className="tabular-nums">-{formatNpr(t.loyaltyDiscount)}</dd>
            </div>
          )}
          {t.serviceCharge > 0 && (
            <div className="flex justify-between">
              <dt>Service charge</dt>
              <dd className="tabular-nums">{formatNpr(t.serviceCharge)}</dd>
            </div>
          )}
          {t.vat > 0 && (
            <div className="flex justify-between">
              <dt>VAT</dt>
              <dd className="tabular-nums">{formatNpr(t.vat)}</dd>
            </div>
          )}
          {t.deliveryFee > 0 && (
            <div className="flex justify-between">
              <dt>Delivery</dt>
              <dd className="tabular-nums">{formatNpr(t.deliveryFee)}</dd>
            </div>
          )}
          {t.roundOff !== 0 && (
            <div className="flex justify-between">
              <dt>Round off</dt>
              <dd className="tabular-nums">{formatNpr(t.roundOff)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between border-t border-stone-200 pt-3 text-stone-900">
            <dt className="text-2xl font-semibold">Total</dt>
            <dd className="text-4xl font-bold tabular-nums sm:text-5xl" aria-live="polite">
              {formatNpr(t.grandTotal)}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function QrPanel({ s }: { s: ScreenState }) {
  if (!s.qr) return null;
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border-2 border-brand-600 bg-white p-6 text-center shadow-sm sm:p-8">
      <h2 className="text-3xl font-semibold text-brand-700">{s.qr.kind === "intent" ? `Pay with ${s.qr.label}` : s.qr.label}</h2>
      {s.qr.kind === "intent" && s.qr.svg ? (
        <div className="w-full max-w-[22rem] rounded-2xl bg-white p-2 [&_svg]:h-auto [&_svg]:w-full" role="img" aria-label={`QR code to pay with ${s.qr.label}`} dangerouslySetInnerHTML={{ __html: s.qr.svg }} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.qr.src} alt={s.qr.label} className="max-h-[50vh] w-full max-w-[22rem] rounded-2xl bg-white object-contain p-2" />
      )}
      {s.payAmount !== null && (
        <p className="text-xl text-stone-600">
          Amount to pay <strong className="block text-4xl tabular-nums text-stone-900">{formatNpr(s.payAmount)}</strong>
        </p>
      )}
      <p className="text-lg text-stone-500">{s.qr.kind === "intent" ? "Scan with your phone camera or wallet app." : "Scan, then enter the amount shown."}</p>
    </div>
  );
}

export function DisplayScreen({ token, embedded }: { token: string; embedded: boolean }) {
  const [s, setS] = useState<ScreenState | null>(null);
  const [problem, setProblem] = useState<"none" | "offline" | "invalid">("none");
  const version = useRef("");
  const [cursor, setCursor] = useState(true);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/display/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (res.status === 404) {
        setProblem("invalid");
        return;
      }
      if (!res.ok) throw new Error("bad");
      const next = (await res.json()) as ScreenState;
      setProblem("none");
      if (next.version !== version.current) {
        version.current = next.version;
        setS(next);
      }
    } catch {
      setProblem("offline");
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  // The mouse pointer hides itself on a screen nobody is touching.
  useEffect(() => {
    let h: ReturnType<typeof setTimeout>;
    const move = () => {
      setCursor(true);
      clearTimeout(h);
      h = setTimeout(() => setCursor(false), 3000);
    };
    move();
    window.addEventListener("mousemove", move);
    return () => {
      window.removeEventListener("mousemove", move);
      clearTimeout(h);
    };
  }, []);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  if (problem === "invalid") {
    return (
      <main className="grid min-h-screen place-items-center bg-stone-100 p-8 text-center">
        <div>
          <h1 className="text-3xl font-semibold">This screen is not set up</h1>
          <p className="mt-2 text-lg text-stone-600">Ask the staff for a new link.</p>
        </div>
      </main>
    );
  }
  if (!s) return <main className="grid min-h-screen place-items-center bg-stone-100 text-stone-500">Loading…</main>;
  if (s.kind === "OFF") {
    return (
      <main className="grid min-h-screen place-items-center bg-stone-100 p-8 text-center">
        <div>
          <Brand s={s} />
          <p className="mt-4 text-xl text-stone-500">This screen is switched off.</p>
        </div>
      </main>
    );
  }

  const showBill = s.kind === "BILL" || s.kind === "PAY";
  return (
    <main onDoubleClick={embedded ? undefined : fullscreen} className={`flex min-h-screen flex-col bg-stone-100 p-4 text-stone-900 sm:p-8 ${cursor ? "" : "cursor-none"}`}>
      <header className="mb-5 flex items-center justify-between gap-4">
        <Brand s={s} />
        <div className="flex items-center gap-3">
          {s.where && showBill && <span className="rounded-full bg-white px-4 py-1.5 text-lg font-medium text-stone-600 shadow-sm">{s.where}</span>}
          {problem === "offline" && <span className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-900">Reconnecting…</span>}
          {!embedded && (
            <button type="button" onClick={fullscreen} aria-label="Full screen" className={`grid size-10 place-items-center rounded-xl text-stone-400 hover:bg-white hover:text-stone-700 ${cursor ? "" : "opacity-0"}`}>
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {s.kind === "IDLE" && (
        <section className="grid flex-1 place-items-center text-center" aria-live="polite">
          <div className="max-w-3xl">
            <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">{s.title}</h1>
            <p className="mt-5 text-2xl text-stone-500 sm:text-3xl">{s.text}</p>
          </div>
        </section>
      )}

      {showBill && (
        <section className={`grid min-h-0 flex-1 gap-5 ${s.qr ? "lg:grid-cols-[3fr_2fr]" : ""}`} aria-live="polite">
          <Bill s={s} compact={!!s.qr} />
          <QrPanel s={s} />
        </section>
      )}

      {(s.kind === "PAID" || s.kind === "THANKS") && (
        <section className="grid flex-1 place-items-center text-center" aria-live="polite">
          <div className="flex flex-col items-center gap-4">
            <Check />
            <h1 className="max-w-3xl text-5xl font-semibold tracking-tight sm:text-6xl">{s.kind === "PAID" ? "Payment received" : s.title}</h1>
            {s.paidAmount !== null && <p className="text-3xl text-stone-600 tabular-nums">{formatNpr(s.paidAmount)}</p>}
            {s.kind === "PAID" && <p className="text-xl text-stone-500">One moment while we finish your bill.</p>}
          </div>
        </section>
      )}
    </main>
  );
}
