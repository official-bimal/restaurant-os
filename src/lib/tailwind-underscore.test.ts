import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tailwind turns every underscore inside square brackets into a space. A class like `group-has-[input[value=DINE_IN]:checked]:block`
 * therefore becomes the selector `input[value=DINE IN]`, which is invalid, so the browser drops the whole rule and whatever it was meant
 * to show stays hidden. (That is exactly how the table choice disappeared from the Orders page.) Write the underscore as a backslash and
 * an underscore, or avoid it. This test reads every source file and refuses a bracketed variant that has a bare underscore.
 */

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "generated" || name === "node_modules" ? [] : files(p);
    return /\.(tsx|ts|css)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

// A variant that takes a selector in brackets: has-[...], not-[...], in-[...] (also with group-/peer- in front). The brackets nest
// (`[input[value=X]:checked]`), so the end is found by counting them.
const START = /(?:group-|peer-)?(?:has|not|in)-\[/g;

function variants(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(START)) {
    let depth = 0;
    let end = m.index! + m[0].length - 1;
    for (; end < text.length; end++) {
      const ch = text[end]!;
      if (ch === "[") depth++;
      else if (ch === "]" && --depth === 0) break;
      else if (/[\s"'`]/.test(ch)) break; // a class name ends at a space or a quote
    }
    found.push(text.slice(m.index!, end + 1));
  }
  return found;
}

const BARE_UNDERSCORE = new RegExp("(^|[^\\\\])_");
const hasBareUnderscore = (cls: string) => BARE_UNDERSCORE.test(cls);

describe("Tailwind class names", () => {
  it("never put a bare underscore inside a bracketed selector", () => {
    const bad: string[] = [];
    for (const file of files(join(process.cwd(), "src"))) {
      for (const cls of variants(readFileSync(file, "utf8"))) {
        if (hasBareUnderscore(cls)) bad.push(`${file.replace(process.cwd(), "")}: ${cls}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the check itself notices the mistake that hid the table choice", () => {
    const mistake = '<div className="hidden group-has-[input[value=DINE_IN]:checked]:block">';
    expect(variants(mistake).filter(hasBareUnderscore)).toEqual(["group-has-[input[value=DINE_IN]:checked]"]);
  });

  it("accepts the fixed forms: no underscore, or an escaped one", () => {
    const fixed = 'x group-has-[input[value^=DINE]:checked]:block group-has-[input[value=DINE\\_IN]:checked]:block has-[:checked]:bg-brand-50';
    expect(variants(fixed).filter(hasBareUnderscore)).toEqual([]);
    expect(variants(fixed)).toHaveLength(3);
  });
});
