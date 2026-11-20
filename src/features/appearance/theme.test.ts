import { describe, expect, it } from "vitest";
import { accentVars, buildAccent, cleanAccent, cleanMode, contrast, DARK_SURFACE, DEFAULT_ACCENT, effectiveAccent, PALETTES } from "./theme";

describe("accent colours", () => {
  it("accepts hex colours and refuses anything else", () => {
    expect(cleanAccent("#ABC")).toBe("#aabbcc");
    expect(cleanAccent(" #4F46E5 ")).toBe("#4f46e5");
    for (const bad of ["red", "#12345", "4f46e5", "url(x)", "#gggggg", "", null, 5]) expect(() => cleanAccent(bad)).toThrow(/colour/);
  });
  it("only knows the three modes", () => {
    expect(cleanMode("DARK")).toBe("DARK");
    expect(cleanMode("dark")).toBe("SYSTEM");
    expect(cleanMode(undefined)).toBe("SYSTEM");
  });
  it("keeps the standard indigo exactly as it was", () => {
    expect(buildAccent(DEFAULT_ACCENT).light[600]).toBe("#4f46e5");
    expect(buildAccent(DEFAULT_ACCENT).light[50]).toBe("#eef2ff");
  });
  it("makes white button text readable for every preset and for awkward colours", () => {
    for (const p of PALETTES) expect(buildAccent(p.hex).buttonContrast).toBeGreaterThanOrEqual(4.5);
    for (const hex of ["#ffff00", "#ffffff", "#00ff88", "#fde047", "#000000"]) {
      const a = buildAccent(hex);
      expect(contrast(a.light[600], "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps link and active text readable on dark surfaces", () => {
    for (const hex of [...PALETTES.map((p) => p.hex), "#000000", "#ffff00", "#1e3a8a"]) {
      const d = buildAccent(hex).dark;
      expect(contrast(d[700], DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("gives CSS variables for both modes", () => {
    const v = accentVars("#047857");
    for (const k of [50, 100, 500, 600, 700, 900]) {
      expect(v[`--accent-l-${k}`]).toMatch(/^#[0-9a-f]{6}$/);
      expect(v[`--accent-d-${k}`]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it("picks the personal colour, else the business colour, else indigo, and ignores bad stored values", () => {
    expect(effectiveAccent("#be123c", "#047857")).toBe("#be123c");
    expect(effectiveAccent(null, "#047857")).toBe("#047857");
    expect(effectiveAccent(undefined, undefined)).toBe(DEFAULT_ACCENT);
    expect(effectiveAccent("javascript:alert(1)", "#047857")).toBe("#047857");
  });
});
