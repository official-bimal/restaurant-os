"use client";

import { useSyncExternalStore } from "react";
import { isLang, translate, type Lang, type StringKey } from "@/features/guest/i18n";

/**
 * The guest's language, kept on their phone (not on the server) and shared by every piece of the page. English until they
 * choose Nepali. The page is first drawn in English on the server and switches as soon as it reaches the phone.
 */
const KEY = "ros-guest-lang";
const EVENT = "ros-guest-lang-change";

function read(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    return isLang(v) ? v : "en";
  } catch {
    return "en";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, read, () => "en" as Lang);
  const set = (l: Lang) => {
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* storage blocked: the change still applies until the page is closed */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [lang, set];
}

/** `const t = useT(); t("add")`. */
export function useT() {
  const [lang] = useLang();
  return (key: StringKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
}

/** Text for a key, for use inside server-rendered pages: `<T k="startOrdering" />`. */
export function T({ k, v }: { k: StringKey; v?: Record<string, string | number> }) {
  const t = useT();
  return <>{t(k, v)}</>;
}

/** The English / नेपाली switch. Shown on every guest page. */
export function LangSwitch() {
  const [lang, setLang] = useLang();
  return (
    <div role="group" aria-label={translate(lang, "language")} className="flex justify-end gap-1 text-sm">
      {(["en", "ne"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          lang={l}
          className={`min-h-9 rounded-full px-3 font-medium ${lang === l ? "bg-brand-600 text-white" : "bg-white text-stone-600 ring-1 ring-white/10"}`}
        >
          {l === "en" ? "English" : "नेपाली"}
        </button>
      ))}
    </div>
  );
}
