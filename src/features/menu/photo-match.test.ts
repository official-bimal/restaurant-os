import { describe, expect, it } from "vitest";
import { matchDish, normalize } from "./photo-match";

const dishes = [
  { id: "1", name: "Cafe Latte" },
  { id: "2", name: "Iced Latte" },
  { id: "3", name: "Espresso" },
  { id: "4", name: "Tea" },
  { id: "5", name: "Black Tea" },
  { id: "6", name: "Sausage (Fried)" },
];

describe("photo to dish matching", () => {
  it("normalizes names and drops the extension", () => {
    expect(normalize("Cafe_Latte 2.JPG")).toBe("cafelatte2");
    expect(normalize("Cafe Latte")).toBe("cafelatte");
  });
  it("matches an exact name whatever the case, spaces or extension", () => {
    expect(matchDish("cafe_latte.jpg", dishes)?.id).toBe("1");
    expect(matchDish("ESPRESSO.png", dishes)?.id).toBe("3");
    expect(matchDish("Sausage Fried.webp", dishes)?.id).toBe("6");
  });
  it("matches a longer file name that contains one dish name, preferring the longest dish name", () => {
    expect(matchDish("IMG_2024 iced latte final.jpeg", dishes)?.id).toBe("2");
    expect(matchDish("black tea photo.jpg", dishes)?.id).toBe("5");
  });
  it("does not guess from very short names or when it is unclear", () => {
    expect(matchDish("my tea shot.jpg", dishes)).toBeNull(); // "tea" is too short to match inside a longer name
    expect(matchDish("latte.jpg", dishes)).toBeNull();
    expect(matchDish("sunset.jpg", dishes)).toBeNull();
    expect(matchDish("", dishes)).toBeNull();
  });
  it("refuses two dishes with the same name", () => {
    expect(matchDish("momo.jpg", [{ id: "a", name: "Momo" }, { id: "b", name: "momo" }])).toBeNull();
  });
});
