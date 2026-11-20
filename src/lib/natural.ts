/**
 * Table names in the order people count them: T1, T2, T3 ... T10, not T1, T10, T2. Numbers inside a name compare as numbers and letters
 * ignore case, so "table 2" comes before "Table 10".
 */
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

/** A new array sorted by a text field in counting order. */
export function sortNatural<T>(list: readonly T[], text: (item: T) => string): T[] {
  return [...list].sort((x, y) => naturalCompare(text(x), text(y)));
}
