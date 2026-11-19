import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * One-off: gives the Nerro Cafe dishes STARTER recipes, so food cost can be worked out as soon as ingredient prices are known.
 *
 * The amounts below are typical café portions and are only a starting point: weigh a few portions and correct them on the Recipes page.
 * The ingredients are created with no stock and NO PRICE. A dish's cost shows once every ingredient in its recipe has been bought
 * (Stock, "Record a purchase", with what you really paid). A dish that already has a recipe is left alone. Safe to run again.
 *   npx tsx scripts/nerro-starter-recipes.ts      (with the app stopped)
 */

type Unit = "g" | "ml" | "piece";
const INGREDIENTS: Record<string, Unit> = {
  "Coffee beans": "g", Milk: "ml", Sugar: "g", Honey: "ml", "Vanilla syrup": "ml", "Chocolate sauce": "ml", "Caramel syrup": "ml", "Condensed milk": "ml",
  Ice: "g", "Lemon juice": "ml", "Mint leaves": "g", "Soda water": "ml", Strawberry: "g", Blueberry: "g", Kiwi: "g", "Mango pulp": "g", "Peach syrup": "ml",
  "Black tea leaves": "g", "Tea masala": "g", "Green tea bag": "piece", Ginger: "g", Watermelon: "g", Curd: "g", Banana: "piece", "Oreo biscuit": "piece", KitKat: "piece",
  "Ice cream": "g", "Matcha powder": "g", Chicken: "g", "Momo wrapper": "piece", Potato: "g", "Cooking oil": "ml", Egg: "piece", Sausage: "piece",
  "Buldak noodles pack": "piece", "Shin Ramen pack": "piece", "Current noodles pack": "piece", "Chau Chau pack": "piece",
  "Coke bottle": "piece", "Sprite bottle": "piece",
  "Hukka flavour Mint": "g", "Hukka flavour Love-66": "g", "Hukka flavour Lady Killer": "g", "Hukka flavour Astro Love": "g", "Hukka coal": "piece",
  "Surya Red stick": "piece", "Surya Lite stick": "piece", "Shikhar Ice stick": "piece",
};

type R = Record<string, number>;
const espresso: R = { "Coffee beans": 18 };
const RECIPES: Record<string, R> = {
  Espresso: espresso,
  Doppio: { "Coffee beans": 36 },
  Lungo: { "Coffee beans": 18 },
  "Americano (Single)": espresso,
  "Americano (Double)": { "Coffee beans": 36 },
  Cappuccino: { "Coffee beans": 18, Milk: 120 },
  "Flat White": { "Coffee beans": 36, Milk: 100 },
  "Cafe Latte": { "Coffee beans": 18, Milk: 200 },
  "Vanilla Latte": { "Coffee beans": 18, Milk: 200, "Vanilla syrup": 20 },
  "Honey Latte": { "Coffee beans": 18, Milk: 200, Honey: 20 },
  "Spanish Latte": { "Coffee beans": 18, Milk: 150, "Condensed milk": 40 },
  Affogato: { "Coffee beans": 18, "Ice cream": 80 },
  "Cafe Mocha": { "Coffee beans": 18, Milk: 180, "Chocolate sauce": 30 },
  "Cafe Con Miel": { "Coffee beans": 18, Milk: 100, Honey: 15, "Condensed milk": 20 },
  "Iced Americano": { "Coffee beans": 18, Ice: 150 },
  "Iced Cappuccino": { "Coffee beans": 18, Milk: 150, Ice: 120 },
  "Iced Latte": { "Coffee beans": 18, Milk: 200, Ice: 120 },
  "Iced Mocha": { "Coffee beans": 18, Milk: 180, "Chocolate sauce": 30, Ice: 120 },
  "Iced Honey Latte": { "Coffee beans": 18, Milk: 200, Honey: 20, Ice: 120 },
  "Iced Vanilla Latte": { "Coffee beans": 18, Milk: 200, "Vanilla syrup": 20, Ice: 120 },
  "Iced Spanish Latte": { "Coffee beans": 18, Milk: 150, "Condensed milk": 40, Ice: 120 },
  "Iced Caramel Macchiato": { "Coffee beans": 18, Milk: 200, "Caramel syrup": 20, "Vanilla syrup": 10, Ice: 120 },
  "Hot Chocolate": { Milk: 250, "Chocolate sauce": 40 },
  "Cold Chocolate": { Milk: 250, "Chocolate sauce": 40, Ice: 120 },
  "Hot Lemon Ginger Honey": { "Lemon juice": 20, Ginger: 10, Honey: 20 },
  "Hot Lemon Honey": { "Lemon juice": 30, Honey: 20 },
  "Virgin Mojito": { "Lemon juice": 30, "Mint leaves": 5, Sugar: 15, "Soda water": 200, Ice: 100 },
  "Strawberry Mojito": { "Lemon juice": 30, "Mint leaves": 5, Sugar: 15, "Soda water": 200, Strawberry: 50, Ice: 100 },
  "Blueberry Mojito": { "Lemon juice": 30, "Mint leaves": 5, Sugar: 15, "Soda water": 200, Blueberry: 50, Ice: 100 },
  "Peach Iced Tea": { "Black tea leaves": 4, "Peach syrup": 30, Sugar: 10, Ice: 120 },
  "Lemon Iced Tea": { "Black tea leaves": 4, "Lemon juice": 30, Sugar: 15, Ice: 120 },
  "Mint Lemonade": { "Lemon juice": 40, "Mint leaves": 5, Sugar: 25, "Soda water": 150, Ice: 100 },
  Lemonade: { "Lemon juice": 40, Sugar: 25, "Soda water": 150, Ice: 100 },
  "Watermelon Juice": { Watermelon: 300, Ice: 50 },
  Coke: { "Coke bottle": 1 },
  Sprite: { "Sprite bottle": 1 },
  "Lemon Water": { "Lemon juice": 30, Sugar: 10 },
  "Black Tea": { "Black tea leaves": 4, Sugar: 10 },
  "Milk Tea": { "Black tea leaves": 4, Milk: 150, Sugar: 10 },
  "Masala Tea": { "Black tea leaves": 4, "Tea masala": 2, Milk: 150, Sugar: 10 },
  "Green Tea": { "Green tea bag": 1 },
  "Ginger Tea": { "Black tea leaves": 4, Ginger: 8, Sugar: 10 },
  "Lemon Tea": { "Black tea leaves": 4, "Lemon juice": 20, Sugar: 10 },
  "Strawberry Smoothie": { Strawberry: 120, Milk: 150, Sugar: 15, Ice: 80 },
  "Blueberry Smoothie": { Blueberry: 120, Milk: 150, Sugar: 15, Ice: 80 },
  "Kiwi Smoothie": { Kiwi: 120, Milk: 150, Sugar: 15, Ice: 80 },
  "Mango Smoothie": { "Mango pulp": 150, Milk: 150, Sugar: 10, Ice: 80 },
  "Plain Lassi": { Curd: 200, Sugar: 25, Ice: 50 },
  "Banana Lassi": { Curd: 200, Banana: 1, Sugar: 15 },
  "Oreo Shake": { Milk: 250, "Ice cream": 100, "Oreo biscuit": 3 },
  "Kitkat Shake": { Milk: 250, "Ice cream": 100, KitKat: 2 },
  "Hot Matcha Latte": { "Matcha powder": 5, Milk: 200, Sugar: 10 },
  "Iced Matcha Latte": { "Matcha powder": 5, Milk: 200, Sugar: 10, Ice: 120 },
  "Strawberry Iced Matcha": { "Matcha powder": 5, Milk: 200, Sugar: 10, Strawberry: 40, Ice: 120 },
  "Blueberry Iced Matcha": { "Matcha powder": 5, Milk: 200, Sugar: 10, Blueberry: 40, Ice: 120 },
  "Kiwi Iced Matcha": { "Matcha powder": 5, Milk: 200, Sugar: 10, Kiwi: 40, Ice: 120 },
  "Mango Iced Matcha": { "Matcha powder": 5, Milk: 200, Sugar: 10, "Mango pulp": 50, Ice: 120 },
  "Chicken Momo": { Chicken: 120, "Momo wrapper": 10, "Cooking oil": 5 },
  "French Fry": { Potato: 250, "Cooking oil": 40 },
  Buldak: { "Buldak noodles pack": 1 },
  "Shin Ramen": { "Shin Ramen pack": 1 },
  Current: { "Current noodles pack": 1 },
  "Chau Chau Sadeko": { "Chau Chau pack": 1, "Cooking oil": 5 },
  "Sausage (Fried)": { Sausage: 2, "Cooking oil": 10 },
  "Sausage (Boiled)": { Sausage: 2 },
  "Egg (Boiled)": { Egg: 1 },
  "Egg (Fried)": { Egg: 1, "Cooking oil": 5 },
  "Egg (Sunny Side)": { Egg: 1, "Cooking oil": 5 },
  "Hukka Mint": { "Hukka flavour Mint": 20, "Hukka coal": 2 },
  "Hukka Love-66": { "Hukka flavour Love-66": 20, "Hukka coal": 2 },
  "Hukka Lady Killer": { "Hukka flavour Lady Killer": 20, "Hukka coal": 2 },
  "Hukka Astro Love": { "Hukka flavour Astro Love": 20, "Hukka coal": 2 },
  "Extra Coil": { "Hukka coal": 1 },
  "Surya Red": { "Surya Red stick": 1 },
  "Surya Lite": { "Surya Lite stick": 1 },
  "Shikhar Ice": { "Shikhar Ice stick": 1 },
};

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const biz = await db.business.findFirstOrThrow({ where: { name: "Nerro Cafe" } });
    const businessId = biz.id;
    const branches = await db.branch.findMany({ where: { businessId, active: true }, select: { id: true } });

    const stock = new Map<string, string>();
    let newItems = 0;
    for (const [name, unit] of Object.entries(INGREDIENTS)) {
      let item = await db.stockItem.findFirst({ where: { businessId, name } });
      if (!item) {
        item = await db.stockItem.create({ data: { businessId, name, unit } });
        newItems++;
      }
      stock.set(name, item.id);
      for (const b of branches) {
        await db.branchStock.upsert({
          where: { branchId_stockItemId: { branchId: b.id, stockItemId: item.id } },
          create: { businessId, branchId: b.id, stockItemId: item.id, quantity: 0, reorderLevel: 0, costMilli: 0 },
          update: {},
        });
      }
    }

    let made = 0;
    let kept = 0;
    let missing = 0;
    for (const [dish, lines] of Object.entries(RECIPES)) {
      const item = await db.menuItem.findFirst({ where: { businessId, name: dish } });
      if (!item) {
        missing++;
        continue;
      }
      if ((await db.recipeLine.count({ where: { businessId, menuItemId: item.id } })) > 0) {
        kept++;
        continue;
      }
      await db.recipeLine.createMany({
        data: Object.entries(lines).map(([ing, quantity]) => ({ businessId, menuItemId: item.id, stockItemId: stock.get(ing)!, quantity })),
      });
      made++;
    }
    console.log(`Ingredients: ${newItems} new. Recipes: ${made} written, ${kept} already had one (left alone), ${missing} dishes not found.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
