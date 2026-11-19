import { describe, expect, it } from "vitest";
import { iconLetter, parseIconSpec } from "@/lib/pwa-icon";
import { customerManifest, shorten } from "./manifest";

const token = "wRkuemlDgiqdJfkpPDCExKBG";

describe("customerManifest", () => {
  const m = customerManifest({ token, businessName: "Demo Cafe", branchName: "Main branch" });

  it("opens the restaurant's own ordering page, and nothing outside it", () => {
    expect(m.start_url).toBe(`/o/${token}`);
    expect(m.scope).toBe(`/o/${token}`);
    expect(m.id).toBe(`/o/${token}`);
    expect(m.display).toBe("standalone");
    expect(m.start_url.startsWith(m.scope)).toBe(true);
  });

  it("is named after the restaurant", () => {
    expect(m.name).toBe("Demo Cafe");
    expect(m.short_name).toBe("Demo Cafe");
    expect(m.description).toContain("Demo Cafe");
  });

  it("has what an installable app needs: a 192 and a 512 icon, and a maskable one", () => {
    const sizes = m.icons.map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(["192x192:any", "512x512:any", "512x512:maskable"]);
    for (const i of m.icons) {
      expect(i.type).toBe("image/png");
      expect(i.src.startsWith(`/o/${token}/icon/`)).toBe(true);
      const spec = i.src.split("/icon/")[1]!;
      expect(parseIconSpec(spec)).not.toBeNull(); // every icon the manifest names is one the server can draw
    }
  });

  it("copes with long and odd names", () => {
    const long = customerManifest({ token, businessName: "The Very Long Named Restaurant and Bar of Kathmandu Valley Heritage", branchName: "x" });
    expect(long.name.length).toBeLessThanOrEqual(45);
    expect(long.short_name.length).toBeLessThanOrEqual(12);
    expect(customerManifest({ token, businessName: "   ", branchName: "x" })).toMatchObject({ name: "Order online", short_name: "Order" });
  });
});

describe("shorten", () => {
  it("cuts at a word where it can", () => {
    expect(shorten("Himalayan Java Coffee", 12)).toBe("Himalayan");
    expect(shorten("Short", 12)).toBe("Short");
    expect(shorten("Supercalifragilistic", 12)).toBe("Supercalifra");
    expect(shorten("  a   b  ", 12)).toBe("a b");
  });
});

describe("icons", () => {
  it("only serves the sizes the manifests ask for", () => {
    expect(parseIconSpec("192")).toEqual({ size: 192, maskable: false });
    expect(parseIconSpec("512")).toEqual({ size: 512, maskable: false });
    expect(parseIconSpec("maskable-512")).toEqual({ size: 512, maskable: true });
    expect(parseIconSpec("180")).toEqual({ size: 180, maskable: false });
    for (const bad of ["0", "1", "64", "5000", "512x512", "maskable", "../512", "", "maskable-64"]) expect(parseIconSpec(bad)).toBeNull();
  });

  it("uses the first letter or digit of a name, in any script", () => {
    expect(iconLetter("demo cafe")).toBe("D");
    expect(iconLetter("  ☕ Chiya Ghar")).toBe("C");
    expect(iconLetter("नेपाली कफी")).toBe("न");
    expect(iconLetter("7 Hills")).toBe("7");
    expect(iconLetter("")).toBe("R");
    expect(iconLetter("☕☕")).toBe("R");
  });
});
