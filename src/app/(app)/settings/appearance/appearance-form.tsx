"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { accentVars, buildAccent, DEFAULT_ACCENT, PALETTES, type ThemeMode } from "@/features/appearance/theme";

/**
 * Personal look: light, dark or follow the device, and an accent colour. While you choose, the whole page changes at once (the real app
 * wrapper), so you see exactly what you will get. Leaving without saving puts everything back.
 */

const MODES: { value: ThemeMode; label: string; icon: string; hint: string }[] = [
  { value: "LIGHT", label: "Light", icon: "sun", hint: "Bright and clear" },
  { value: "DARK", label: "Dark", icon: "moon", hint: "Easy on the eyes at night" },
  { value: "SYSTEM", label: "System", icon: "layout", hint: "Follows your device" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function AppearanceForm({ mode, accent, businessAccent, save, reset }: { mode: ThemeMode; accent: string | null; businessAccent: string | null; save: (fd: FormData) => void | Promise<void>; reset: () => void | Promise<void> }) {
  const [m, setM] = useState<ThemeMode>(mode);
  // null means "use the business colour".
  const [c, setC] = useState<string | null>(accent);
  const [text, setText] = useState(accent ?? "");
  const original = useRef<{ ui: string | null; style: string | null } | null>(null);
  const fallback = businessAccent ?? DEFAULT_ACCENT;
  const shown = c ?? fallback;
  const info = useMemo(() => buildAccent(shown), [shown]);
  const adjusted = info.light[600].toLowerCase() !== shown.toLowerCase();

  // Live preview on the real page.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>("[data-ui]");
    if (!el) return;
    if (!original.current) original.current = { ui: el.getAttribute("data-ui"), style: el.getAttribute("style") };
    el.setAttribute("data-ui", m.toLowerCase());
    for (const [k, v] of Object.entries(accentVars(shown))) el.style.setProperty(k, v);
  }, [m, shown]);
  useEffect(
    () => () => {
      const el = document.querySelector<HTMLElement>("[data-ui]");
      const o = original.current;
      if (!el || !o) return;
      if (o.ui) el.setAttribute("data-ui", o.ui);
      if (o.style !== null) el.setAttribute("style", o.style);
    },
    [],
  );

  const pick = (hex: string | null) => {
    setC(hex);
    setText(hex ?? "");
  };
  const dirty = m !== mode || (c ?? "") !== (accent ?? "");

  return (
    <form action={save} className="space-y-6">
      <fieldset className="card p-5">
        <legend className="px-1 text-lg font-semibold">Light, dark or system</legend>
        <p className="mb-3 text-sm text-stone-600">Your own choice. It follows you to every device you sign in on.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {MODES.map((x) => (
            <label key={x.value} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500 ${m === x.value ? "border-brand-500 bg-brand-50" : "border-stone-200 hover:bg-stone-50"}`}>
              <input type="radio" name="mode" value={x.value} checked={m === x.value} onChange={() => setM(x.value)} className="sr-only" />
              <span className="grid size-10 place-items-center rounded-xl bg-stone-100 text-brand-600">
                <Icon name={x.icon} className="size-5" />
              </span>
              <span>
                <span className="block font-medium">{x.label}</span>
                <span className="block text-xs text-stone-500">{x.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="card p-5">
        <legend className="px-1 text-lg font-semibold">Theme colour</legend>
        <p className="mb-3 text-sm text-stone-600">Buttons, the active menu item, links and charts use this colour.</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Preset colours">
          <label className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500 ${c === null ? "border-brand-500 bg-brand-50" : "border-stone-200 hover:bg-stone-50"}`}>
            <input type="radio" name="accentChoice" checked={c === null} onChange={() => pick(null)} className="sr-only" />
            <span className="size-5 rounded-full border border-stone-300" style={{ background: fallback }} />
            {businessAccent ? "Business colour" : "Standard"}
          </label>
          {PALETTES.map((p) => (
            <label key={p.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500 ${c?.toLowerCase() === p.hex ? "border-brand-500 bg-brand-50" : "border-stone-200 hover:bg-stone-50"}`}>
              <input type="radio" name="accentChoice" checked={c?.toLowerCase() === p.hex} onChange={() => pick(p.hex)} className="sr-only" />
              <span className="size-5 rounded-full" style={{ background: p.hex }} />
              {p.name}
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Your own colour
            <span className="mt-1 flex items-center gap-2">
              <input
                type="color"
                aria-label="Pick a colour"
                value={HEX.test(text) ? text : shown}
                onChange={(e) => pick(e.target.value)}
                className="h-10 w-12 cursor-pointer rounded-lg border border-stone-300 bg-transparent p-1"
              />
              <input
                aria-label="Colour as a hex code"
                value={text}
                maxLength={7}
                placeholder="#4f46e5"
                onChange={(e) => {
                  setText(e.target.value);
                  if (HEX.test(e.target.value)) setC(e.target.value.toLowerCase());
                }}
                className="w-28 px-3 py-2 font-mono text-sm"
              />
            </span>
          </label>
          <p className={`text-sm ${adjusted ? "text-amber-800" : "text-emerald-800"}`} role="status">
            Button text contrast {info.buttonContrast.toFixed(1)}:1 {info.buttonContrast >= 4.5 ? "(passes AA)" : ""}.{adjusted ? " Slightly darkened so white text stays easy to read." : ""}
          </p>
        </div>
        <input type="hidden" name="accent" value={c ?? ""} />

        <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4" aria-label="Preview">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Preview</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="btn-primary">Primary button</span>
            <span className="btn-secondary">Secondary</span>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">Active item</span>
            <span className="text-sm font-medium text-brand-700 underline">A link</span>
            <span className="h-2 w-32 overflow-hidden rounded-full bg-stone-200">
              <span className="block h-full w-2/3 rounded-full bg-brand-600" />
            </span>
          </div>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={!dirty}>
          Save appearance
        </button>
        <button type="submit" formAction={reset} className="btn-secondary">
          Reset to default
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!dirty}
          onClick={() => {
            setM(mode);
            pick(accent);
          }}
        >
          Cancel
        </button>
        {dirty && <span className="text-sm text-amber-800">Previewing. Not saved yet.</span>}
      </div>
    </form>
  );
}
