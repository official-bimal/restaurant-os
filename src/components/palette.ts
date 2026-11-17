/**
 * One colour per area of the app, so the menu and the dashboard are easy to scan. Class names are
 * written out in full (not built from strings) so Tailwind can see them.
 */
export type Tone = "blue" | "orange" | "violet" | "rose" | "amber" | "pink" | "emerald" | "slate" | "teal";

export const TONES: Record<Tone, { tile: string; text: string; activeBg: string; bar: string }> = {
  blue: { tile: "bg-blue-100 text-blue-600", text: "text-blue-700", activeBg: "bg-blue-50", bar: "bg-blue-500" },
  orange: { tile: "bg-orange-100 text-orange-600", text: "text-orange-700", activeBg: "bg-orange-50", bar: "bg-orange-500" },
  violet: { tile: "bg-violet-100 text-violet-600", text: "text-violet-700", activeBg: "bg-violet-50", bar: "bg-violet-500" },
  rose: { tile: "bg-rose-100 text-rose-600", text: "text-rose-700", activeBg: "bg-rose-50", bar: "bg-rose-500" },
  amber: { tile: "bg-amber-100 text-amber-600", text: "text-amber-700", activeBg: "bg-amber-50", bar: "bg-amber-500" },
  pink: { tile: "bg-pink-100 text-pink-600", text: "text-pink-700", activeBg: "bg-pink-50", bar: "bg-pink-500" },
  emerald: { tile: "bg-emerald-100 text-emerald-600", text: "text-emerald-700", activeBg: "bg-emerald-50", bar: "bg-emerald-500" },
  slate: { tile: "bg-slate-200 text-slate-600", text: "text-slate-700", activeBg: "bg-slate-100", bar: "bg-slate-500" },
  teal: { tile: "bg-teal-100 text-teal-600", text: "text-teal-700", activeBg: "bg-teal-50", bar: "bg-teal-500" },
};
