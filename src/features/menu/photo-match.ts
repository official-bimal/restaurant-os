/**
 * Matching a photo's file name to a dish, so a folder of photos named after the dishes ("Cafe Latte.jpg", "cafe_latte.png", "IMG cappuccino 2.jpeg")
 * can be loaded in one go. Pure functions, no I/O.
 */

/** Letters and digits only, lower case, without the file extension. */
export function normalize(text: string): string {
  return text
    .replace(/\.[A-Za-z0-9]{2,5}$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export interface DishRef {
  id: string;
  name: string;
}

/**
 * The dish a file name belongs to, or null when it is not clear. An exact match wins. Otherwise the file name must contain exactly one dish
 * name's letters (the longest such name wins, so "Iced Latte" beats "Latte"); names shorter than 4 letters are only matched exactly.
 */
export function matchDish(fileName: string, dishes: DishRef[]): DishRef | null {
  const f = normalize(fileName);
  if (!f) return null;
  const exact = dishes.filter((d) => normalize(d.name) === f);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const inside = dishes.filter((d) => {
    const n = normalize(d.name);
    return n.length >= 4 && f.includes(n);
  });
  if (inside.length === 0) return null;
  const longest = Math.max(...inside.map((d) => normalize(d.name).length));
  const best = inside.filter((d) => normalize(d.name).length === longest);
  return best.length === 1 ? best[0]! : null;
}
