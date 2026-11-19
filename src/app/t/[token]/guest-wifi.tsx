"use client";

import { useState } from "react";
import { useT } from "./lang";

/**
 * The branch's guest Wi-Fi on the table page. A web page cannot join a Wi-Fi network for the guest (phones do not allow it), so this
 * shows the name and password with copy buttons, and a QR code (`qr` is the SVG, drawn on the server) that another phone's camera
 * turns into a "join this network" offer.
 */
export function GuestWifi({ name, password, hidden, qr }: { name: string; password: string; hidden: boolean; qr: string }) {
  const t = useT();
  const [copied, setCopied] = useState<"name" | "password" | null>(null);

  const copy = async (which: "name" | "password", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers, or a page without a secure address: fall back to selecting the text through a temporary field.
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing more to try: the text is on screen to type */
      }
      document.body.removeChild(el);
    }
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
  };

  const row = (label: string, value: string, which: "name" | "password") => (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-stone-500">{label}</p>
        <p className="break-all font-mono text-base font-semibold">{value}</p>
      </div>
      <button
        type="button"
        onClick={() => copy(which, value)}
        aria-label={`${t("wifiCopy")}: ${label}`}
        className="min-h-10 shrink-0 rounded-full bg-white/10 px-4 text-sm font-medium ring-1 ring-white/10"
      >
        {copied === which ? t("wifiCopied") : t("wifiCopy")}
      </button>
    </div>
  );

  return (
    <section aria-label={t("wifiTitle")} className="mb-5 space-y-3 rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold">
        <span aria-hidden="true">📶</span> {t("wifiTitle")}
      </h2>
      {row(t("wifiNetwork"), name, "name")}
      {password ? row(t("wifiPassword"), password, "password") : <p className="text-sm text-stone-600">{t("wifiOpen")}</p>}
      <p className="text-xs text-stone-500">{t("wifiHelp")}</p>
      {hidden && <p className="text-xs text-amber-700">{t("wifiHidden")}</p>}
      <details className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
        <summary className="cursor-pointer text-sm font-medium">{t("wifiQr")}</summary>
        <div role="img" aria-label={`QR code for the Wi-Fi network ${name}`} className="mx-auto my-3 w-48 rounded-xl bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="text-center text-xs text-stone-500">{t("wifiQrHelp")}</p>
      </details>
    </section>
  );
}
