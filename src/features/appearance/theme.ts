import { DomainError } from "@/server/errors";

/**
 * Pure theme maths: colour palettes, a whole accent scale from one colour, and contrast checks. The app is coloured through CSS variables
 * (--color-brand-50 to 900), so one accent colour re-colours buttons, active menu items, links and charts in light and dark mode.
 */

export const THEME_MODES = ["LIGHT", "DARK", "SYSTEM"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const DEFAULT_ACCENT = "#4f46e5";

/** Curated palettes. Each is dark enough for white button text (contrast 4.5 or more). */
export const PALETTES: { id: string; name: string; hex: string }[] = [
  { id: "indigo", name: "Indigo", hex: "#4f46e5" },
  { id: "emerald", name: "Emerald", hex: "#047857" },
  { id: "teal", name: "Teal", hex: "#0f766e" },
  { id: "sky", name: "Ocean", hex: "#0369a1" },
  { id: "violet", name: "Violet", hex: "#6d28d9" },
  { id: "rose", name: "Rose", hex: "#be123c" },
  { id: "amber", name: "Copper", hex: "#b45309" },
  { id: "slate", name: "Slate", hex: "#334155" },
];

export function cleanMode(v: unknown): ThemeMode {
  return (THEME_MODES as readonly string[]).includes(v as string) ? (v as ThemeMode) : "SYSTEM";
}

/** "#RGB" or "#RRGGBB" in any case becomes "#rrggbb"; anything else is refused. */
export function cleanAccent(v: unknown): string {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(t);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`;
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  throw new DomainError("Enter a colour like #4f46e5.");
}

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb([h, s, l]: [number, number, number]): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** WCAG relative luminance and contrast ratio. */
function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: string, b: string): number {
  const la = luminance(hexToRgb(a)), lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const withL = (hex: string, l: number) => {
  const [h, s] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb([h, s, Math.min(0.97, Math.max(0.03, l))]));
};
const lightnessOf = (hex: string) => rgbToHsl(hexToRgb(hex))[2];
const mix = (a: string, b: string, t: number) => {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
};

/** Move lightness toward `against` in small steps until the colour reaches the wanted contrast. */
function toContrast(hex: string, against: string, wanted: number, darker: boolean): string {
  let c = hex;
  for (let i = 0; i < 40 && contrast(c, against) < wanted; i++) c = withL(c, lightnessOf(c) + (darker ? -0.02 : 0.02));
  return c;
}

export const DARK_SURFACE = "#1c1c1f";
const WHITE = "#ffffff";

export interface AccentScale {
  50: string;
  100: string;
  500: string;
  600: string;
  700: string;
  900: string;
}

const INDIGO_LIGHT: AccentScale = { 50: "#eef2ff", 100: "#e0e7ff", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca", 900: "#312e81" };

/** The accent scale for light and dark mode. 600 is the button colour: white text on it always reaches contrast 4.5. */
export function buildAccent(hex: string): { light: AccentScale; dark: AccentScale; buttonContrast: number } {
  const base = cleanAccent(hex);
  const c600 = toContrast(base, WHITE, 4.5, true);
  const light: AccentScale =
    c600 === DEFAULT_ACCENT
      ? INDIGO_LIGHT
      : { 600: c600, 500: withL(c600, lightnessOf(c600) + 0.07), 700: withL(c600, lightnessOf(c600) - 0.07), 900: withL(c600, lightnessOf(c600) - 0.22), 50: mix(c600, WHITE, 0.92), 100: mix(c600, WHITE, 0.84) };
  // In dark mode text-brand-700 must be readable on dark surfaces, so it is the accent made lighter; tints are the accent faintly over the surface.
  const text = toContrast(mix(c600, WHITE, 0.35), DARK_SURFACE, 5, false);
  const dark: AccentScale = { 600: c600, 500: toContrast(mix(c600, WHITE, 0.2), DARK_SURFACE, 3, false), 700: text, 900: mix(text, WHITE, 0.25), 50: mix(DARK_SURFACE, c600, 0.2), 100: mix(DARK_SURFACE, c600, 0.32) };
  return { light, dark, buttonContrast: contrast(c600, WHITE) };
}

/** Inline CSS variables for the app shell: both scales, picked by the dark/light rules in globals.css. */
export function accentVars(hex: string): Record<string, string> {
  const a = buildAccent(hex);
  const out: Record<string, string> = {};
  for (const k of [50, 100, 500, 600, 700, 900] as const) {
    out[`--accent-l-${k}`] = a.light[k];
    out[`--accent-d-${k}`] = a.dark[k];
  }
  return out;
}

/** The colour actually used: the person's own, else the business colour, else the standard indigo. */
export function effectiveAccent(personal: string | null | undefined, business: string | null | undefined): string {
  for (const c of [personal, business]) {
    if (!c) continue;
    try {
      return cleanAccent(c);
    } catch {
      /* a bad stored value is skipped, not fatal */
    }
  }
  return DEFAULT_ACCENT;
}
