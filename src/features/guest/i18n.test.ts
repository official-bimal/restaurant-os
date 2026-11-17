import { describe, expect, it } from "vitest";
import { isLang, placeholdersOf, STRINGS, translate, type StringKey } from "./i18n";

const keys = Object.keys(STRINGS) as StringKey[];

describe("guest strings", () => {
  it("have an English and a Nepali text for every key", () => {
    for (const k of keys) {
      expect(STRINGS[k].en.trim().length, `${k} en`).toBeGreaterThan(0);
      expect(STRINGS[k].ne.trim().length, `${k} ne`).toBeGreaterThan(0);
    }
  });
  it("use the same placeholders in both languages", () => {
    for (const k of keys) expect(placeholdersOf(STRINGS[k].ne), k).toEqual(placeholdersOf(STRINGS[k].en));
  });
  it("write the Nepali in Devanagari, not as a copy of the English", () => {
    for (const k of keys) {
      const ne = STRINGS[k].ne.replace(/\{\w+\}/g, "");
      // a few strings are mostly a name or symbol; the rest must contain Devanagari letters
      if (/[A-Za-z]{6,}/.test(ne) && !/[ऀ-ॿ]/.test(ne)) throw new Error(`${k} is not translated`);
      expect(STRINGS[k].ne, k).not.toBe(STRINGS[k].en);
    }
  });
});

describe("translate", () => {
  it("picks the language and fills placeholders", () => {
    expect(translate("en", "table", { label: "T4" })).toBe("Table T4");
    expect(translate("ne", "table", { label: "T4" })).toBe("टेबल T4");
    expect(translate("ne", "earnedPoints", { points: 12 })).toBe("यो बिलमा तपाईंले 12 अंक कमाउनुभयो।");
  });
  it("leaves an unfilled placeholder visible rather than printing undefined", () => {
    expect(translate("en", "billN")).toBe("Bill {n}");
  });
  it("checks languages", () => {
    expect(isLang("ne")).toBe(true);
    expect(isLang("fr")).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });
});
